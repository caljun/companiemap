import { NextResponse } from 'next/server';
import { getAaplFinancialData } from '@/lib/fmp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await getAaplFinancialData();
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unknown server error occurred.';
    const status = message.startsWith('FMP_API_KEY') ? 500 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
