"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

/**
 * Operator sign-in.
 *
 * The engine proxy holds a server-side admin token, so this page is the only
 * thing standing between the public site and the engine's write routes.
 */

/**
 * Only a same-origin path is a valid destination. A `next` value of
 * `//evil.example` or `https://evil.example` would otherwise turn the sign-in
 * form into an open redirect.
 */
function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(payload?.error?.message ?? "Sign-in failed.");
        return;
      }

      router.push(safeNext(searchParams.get("next")));
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-border bg-card p-6"
    >
      <label
        htmlFor="username"
        className="block text-sm font-medium text-foreground"
      >
        Operator username
      </label>
      <input
        id="username"
        name="username"
        type="text"
        autoComplete="username"
        required
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "signin-error" : undefined}
        className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      <label
        htmlFor="password"
        className="mt-4 block text-sm font-medium text-foreground"
      >
        Operator password
      </label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "signin-error" : undefined}
        className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      {error ? (
        <p
          id="signin-error"
          role="alert"
          className="mt-3 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-5 w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Wands
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-foreground text-balance">
            Operator sign-in
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground text-pretty">
            Engine actions are restricted to the operator. Sign in to continue.
          </p>
        </div>

        <Suspense
          fallback={
            <div className="h-72 rounded-xl border border-border bg-card" />
          }
        >
          <SignInForm />
        </Suspense>
      </div>
    </main>
  );
}
