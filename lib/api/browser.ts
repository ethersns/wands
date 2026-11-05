"use client";

export type MutationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

/**
 * Client-side mutation helper. It only ever reports what the server actually
 * returned — a failed engine call surfaces as a failure, never as a success.
 */
export async function engineMutation<T>(
  path: string,
  init: { method?: "POST" | "PATCH" | "DELETE"; body?: unknown } = {},
): Promise<MutationResult<T>> {
  try {
    const response = await fetch(`/api/wands/${path}`, {
      method: init.method ?? "POST",
      headers: { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

    const payload: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const error = (payload as { error?: { code?: string; message?: string } })
        ?.error;
      return {
        ok: false,
        error: {
          code: error?.code ?? "server_error",
          message:
            error?.message ??
            `The engine rejected the request (HTTP ${response.status}).`,
        },
      };
    }

    return { ok: true, data: payload as T };
  } catch {
    return {
      ok: false,
      error: {
        code: "unreachable",
        message: "Could not reach the Wands server. Check your connection.",
      },
    };
  }
}
