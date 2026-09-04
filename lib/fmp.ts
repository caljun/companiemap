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

function firstRecord(body: unknown, label: string): JsonRecord {
  if (!Array.isArray(body)) {
    throw new Error(`FMP ${label} returned an unexpected response shape; expected an array.`);
  }
  const first = body[0];
  if (!first || typeof first !== 'object' || Array.isArray(first)) {
    throw new Error(`FMP ${label} returned no data for AAPL.`);
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

async function fetchAaplMarketCap(): Promise<MarketCapSnapshot> {
  const marketCapBody = await fetchFmp(
    'market-capitalization',
    { symbol: 'AAPL' },
    'market capitalization',
  );
  const marketCap = firstRecord(marketCapBody, 'market capitalization');

  return {
    marketCap: nullableNumber(marketCap.marketCap),
    updatedAt: new Date().toISOString(),
  };
}

async function fetchAaplAnnualFinancials(): Promise<AnnualFinancialSnapshot> {
  const incomeStatementBody = await fetchFmp(
    'income-statement',
    { symbol: 'AAPL' },
    'income statement',
  );
  const incomeStatement = firstRecord(incomeStatementBody, 'income statement');

  return {
    revenue: nullableNumber(incomeStatement.revenue),
    operatingIncome: nullableNumber(incomeStatement.operatingIncome),
    netIncome: nullableNumber(incomeStatement.netIncome),
    fiscalYear: fiscalYearOf(incomeStatement),
    updatedAt: new Date().toISOString(),
  };
}

const getCachedAaplMarketCap = unstable_cache(
  fetchAaplMarketCap,
  ['fmp', 'AAPL', 'market-capitalization'],
  {
    revalidate: FMP_CACHE_SECONDS.marketCap,
    tags: ['fmp-aapl-market-cap'],
  },
);

const getCachedAaplAnnualFinancials = unstable_cache(
  fetchAaplAnnualFinancials,
  ['fmp', 'AAPL', 'annual-financials'],
  {
    revalidate: FMP_CACHE_SECONDS.annualFinancials,
    tags: ['fmp-aapl-annual-financials'],
  },
);

export async function getAaplFinancialData(): Promise<FinancialData> {
  const [marketCap, annualFinancials] = await Promise.all([
    getCachedAaplMarketCap(),
    getCachedAaplAnnualFinancials(),
  ]);

  return {
    ticker: 'AAPL',
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
