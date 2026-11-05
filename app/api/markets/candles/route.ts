import { NextResponse, type NextRequest } from "next/server";

import type { CandleSeries } from "@/lib/api/contracts";
import { getCandles } from "@/lib/api/endpoints";

const INTERVALS: CandleSeries["interval"][] = [
  "1m",
  "5m",
  "15m",
  "1h",
  "4h",
  "1d",
];

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol");
  const intervalParam = request.nextUrl.searchParams.get("interval") ?? "1h";

  if (!symbol) {
    return NextResponse.json(
      { error: { code: "bad_request", message: "A symbol is required." } },
      { status: 400 },
    );
  }

  const interval = INTERVALS.includes(intervalParam as CandleSeries["interval"])
    ? (intervalParam as CandleSeries["interval"])
    : "1h";

  const envelope = await getCandles(symbol, interval);
  return NextResponse.json(envelope);
}
