import 'server-only';

import { unstable_cache } from 'next/cache';

export type FinancialData = {
  ticker: string;
  marketCap: number | null;
  revenue: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  fiscalYear: number | null;
  updatedAt: string;
};

export type FinancialDataError = {
  ticker: string;
  message: string;
};

export const US_TOP_TEN_TICKERS = [
  'NVDA',
  'AAPL',
  'GOOG',
  'MSFT',
  'AMZN',
  'SPCX',
  'AVGO',
  'META',
  'TSLA',
  'BRK-B',
] as const;

const FMP_BASE_URL = 'https://financialmodelingprep.com/stable';

export const FMP_CACHE_SECONDS = {
  marketCap: 60 * 60 * 12,
  annualFinancials: 60 * 60 * 24 * 7,
} as const;

type JsonRecord = Record<string, unknown>;

type MarketCapSnapshot = {
  marketCap: number | null;
  updatedAt: string;
};

type AnnualFinancialSnapshot = {
  revenue: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  fiscalYear: number | null;
  updatedAt: string;
};

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function fmpErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const record = body as JsonRecord;
  const message = record['Error Message'] ?? record.error ?? record.message;
  return typeof message === 'string' ? message.slice(0, 240) : null;
}

async function fetchFmp(endpoint: string, params: Record<string, string>, label: string): Promise<unknown> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    throw new Error('FMP_API_KEY is not configured on the server.');
  }

  const url = new URL(`${FMP_BASE_URL}/${endpoint}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  url.searchParams.set('apikey', apiKey);

  let response: Response;
  try {
    response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown network error';
    throw new Error(`FMP ${label} request could not be completed: ${reason}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`FMP ${label} returned a non-JSON response (HTTP ${response.status}).`);
  }

  const providerMessage = fmpErrorMessage(body);
  if (!response.ok) {
    throw new Error(`FMP ${label} failed with HTTP ${response.status}${providerMessage ? `: ${providerMessage}` : '.'}`);
  }
  if (providerMessage) {
    throw new Error(`FMP ${label} returned an error: ${providerMessage}`);
  }

  return body;
}

function firstRecord(body: unknown, label: string, ticker: string): JsonRecord {
  if (!Array.isArray(body)) {
    throw new Error(`FMP ${label} returned an unexpected response shape; expected an array.`);
  }
  const first = body[0];
  if (!first || typeof first !== 'object' || Array.isArray(first)) {
    throw new Error(`FMP ${label} returned no data for ${ticker}.`);
  }
  return first as JsonRecord;
}

function fiscalYearOf(statement: JsonRecord): number | null {
  const direct = statement.fiscalYear ?? statement.calendarYear;
  if (typeof direct === 'number' && Number.isInteger(direct)) return direct;
  if (typeof direct === 'string' && /^\d{4}$/.test(direct)) return Number(direct);
  if (typeof statement.date === 'string') {
    const year = Number(statement.date.slice(0, 4));
    return Number.isInteger(year) ? year : null;
  }
  return null;
}

async function fetchMarketCap(ticker: string): Promise<MarketCapSnapshot> {
  const marketCapBody = await fetchFmp(
    'market-capitalization',
    { symbol: ticker },
    `${ticker} market capitalization`,
  );
  const marketCap = firstRecord(marketCapBody, 'market capitalization', ticker);

  return {
    marketCap: nullableNumber(marketCap.marketCap),
    updatedAt: new Date().toISOString(),
  };
}

async function fetchAnnualFinancials(ticker: string): Promise<AnnualFinancialSnapshot> {
  const incomeStatementBody = await fetchFmp(
    'income-statement',
    { symbol: ticker },
    `${ticker} income statement`,
  );
  const incomeStatement = firstRecord(incomeStatementBody, 'income statement', ticker);

  return {
    revenue: nullableNumber(incomeStatement.revenue),
    operatingIncome: nullableNumber(incomeStatement.operatingIncome),
    netIncome: nullableNumber(incomeStatement.netIncome),
    fiscalYear: fiscalYearOf(incomeStatement),
    updatedAt: new Date().toISOString(),
  };
}

const getCachedMarketCap = unstable_cache(
  fetchMarketCap,
  ['fmp', 'market-capitalization'],
  {
    revalidate: FMP_CACHE_SECONDS.marketCap,
    tags: ['fmp-market-cap'],
  },
);

const getCachedAnnualFinancials = unstable_cache(
  fetchAnnualFinancials,
  ['fmp', 'annual-financials'],
  {
    revalidate: FMP_CACHE_SECONDS.annualFinancials,
    tags: ['fmp-annual-financials'],
  },
);

export async function getFinancialData(ticker: string): Promise<FinancialData> {
  const [marketCap, annualFinancials] = await Promise.all([
    getCachedMarketCap(ticker),
    getCachedAnnualFinancials(ticker),
  ]);

  return {
    ticker,
    marketCap: marketCap.marketCap,
    revenue: annualFinancials.revenue,
    operatingIncome: annualFinancials.operatingIncome,
    netIncome: annualFinancials.netIncome,
    fiscalYear: annualFinancials.fiscalYear,
    updatedAt:
      marketCap.updatedAt > annualFinancials.updatedAt
        ? marketCap.updatedAt
        : annualFinancials.updatedAt,
  };
}

export function getAaplFinancialData(): Promise<FinancialData> {
  return getFinancialData('AAPL');
}

type FinancialDataResult =
  | { data: FinancialData; error: null }
  | { data: null; error: FinancialDataError };

const getCachedFinancialDataResult = unstable_cache(
  async (ticker: string): Promise<FinancialDataResult> => {
    try {
      return { data: await getFinancialData(ticker), error: null };
    } catch (error) {
      return {
        data: null,
        error: {
          ticker,
          message: error instanceof Error ? error.message : 'An unknown server error occurred.',
        },
      };
    }
  },
  ['fmp', 'financial-data-result'],
  {
    revalidate: FMP_CACHE_SECONDS.marketCap,
    tags: ['fmp-financial-data-result'],
  },
);

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await task(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

export async function getUsTopTenFinancialData(): Promise<{
  data: FinancialData[];
  errors: FinancialDataError[];
}> {
  const results = await mapWithConcurrency(
    US_TOP_TEN_TICKERS,
    4,
    getCachedFinancialDataResult,
  );

  return {
    data: results.flatMap((result) => (result.data ? [result.data] : [])),
    errors: results.flatMap((result) => (result.error ? [result.error] : [])),
  };
}
