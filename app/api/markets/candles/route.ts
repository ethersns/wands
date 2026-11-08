import { NextResponse, type NextRequest } from "next/server";

import { authorizeOperatorRequest } from "@/lib/admin/guard";
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
  // This route reaches the engine with the server-side admin token, so it is an
  // admin request to the engine whether or not the caller holds a session.
  const auth = await authorizeOperatorRequest();
  if (!auth.ok) {
    return NextResponse.json(
      { error: { code: auth.denial.code, message: auth.denial.message } },
      { status: auth.denial.status },
    );
  }

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
