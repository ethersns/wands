import { NextResponse } from "next/server";

import { engineTimeoutMs, researchFetch } from "@/lib/api/client";

export const dynamic = "force-dynamic";

const PROBE_KEY = "diag-7f3a91c4e2b8";

const PATHS = [
  "/v1/intelligence/dashboard",
  "/v1/intelligence/coverage/public",
  "/v1/intelligence/insiders",
  "/v1/intelligence/institutions",
  "/v1/intelligence/signals",
  "/v1/intelligence/experiments",
];

export async function GET(request: Request) {
  if (request.headers.get("x-diag-key") !== PROBE_KEY) {
    return new NextResponse(null, { status: 404 });
  }

  const results = [];
  for (const path of PATHS) {
    const started = Date.now();
    const result = await researchFetch(path);
    results.push({
      path,
      ms: Date.now() - started,
      ok: result.ok,
      code: result.ok ? null : result.error.code,
      message: result.ok ? null : result.error.message.slice(0, 120),
    });
  }

  return NextResponse.json({ effectiveTimeoutMs: engineTimeoutMs(), results });
}
