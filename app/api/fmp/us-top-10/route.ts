import { NextResponse } from 'next/server';
import {
  FMP_CACHE_SECONDS,
  getUsTopTenFinancialData,
} from '@/lib/fmp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const result = await getUsTopTenFinancialData();
    const status = result.data.length === 0 ? 502 : 200;

    return NextResponse.json(
      {
        ...result,
        cachePolicy: {
          marketCapSeconds: FMP_CACHE_SECONDS.marketCap,
          annualFinancialsSeconds: FMP_CACHE_SECONDS.annualFinancials,
        },
      },
      { status },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unknown server error occurred.';
    const status = message.startsWith('FMP_API_KEY') ? 500 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
