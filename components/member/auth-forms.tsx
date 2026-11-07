"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { memberAuthClient } from "@/lib/auth/member-client";
import { cn } from "@/lib/utils";

const inputClass =
  "w-full rounded-lg border border-mk-line bg-mk-surface px-3 py-2.5 text-sm text-mk-fg placeholder:text-mk-dim focus:border-mk-accent/60 focus:outline-none focus:ring-2 focus:ring-mk-accent/20";

const labelClass = "mb-1.5 block font-marketing-mono text-[11px] uppercase tracking-[0.14em] text-mk-muted";

const primaryButtonClass =
  "inline-flex w-full items-center justify-center rounded-lg bg-mk-accent px-4 py-2.5 text-sm font-semibold text-mk-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60";

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="w-full max-w-md">
      <div className="rounded-2xl border border-mk-line bg-mk-surface/70 p-6 sm:p-8">
        <h1 className="font-display text-2xl font-semibold tracking-[-0.02em] text-mk-fg text-balance">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-mk-muted text-pretty">{subtitle}</p>
        <div className="mt-6">{children}</div>
      </div>
      {footer ? <div className="mt-5 text-center text-sm text-mk-muted">{footer}</div> : null}
    </div>
  );
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg border border-mk-warn/30 bg-mk-warn/10 px-3 py-2 text-sm text-mk-warn">
      {message}
    </p>
  );
}

export function SignInForm({ next }: { next?: string }) {
  const router = useRouter();
  const emailId = useId();
  const passwordId = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const { error: signInError } = await memberAuthClient.signIn.email({ email, password });

    if (signInError) {
      setPending(false);
      setError(
        signInError.status === 403
          ? "Confirm your email address before signing in."
          : "That email and password combination did not work.",
      );
      return;
    }

    router.push(next && next.startsWith("/") ? next : "/app");
    router.refresh();
  }

  return (
    <AuthCard
      title="Sign in"
      subtitle="Pick up where your research left off."
      footer={
        <>
          New to Wands?{" "}
          <Link href="/signup" className="text-mk-accent underline-offset-4 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <FormError message={error} />
        <div>
          <label htmlFor={emailId} className={labelClass}>
            Email
          </label>
          <input
            id={emailId}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            placeholder="you@example.com"
          />
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor={passwordId} className={labelClass}>
              Password
            </label>
            <Link href="/forgot-password" className="mb-1.5 text-xs text-mk-muted hover:text-mk-fg">
              Forgot?
            </Link>
          </div>
          <input
            id={passwordId}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </div>
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? "Signing in" : "Sign in"}
        </button>
      </form>
    </AuthCard>
  );
}

export function SignUpForm({ requiresVerification }: { requiresVerification: boolean }) {
  const router = useRouter();
  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < 10) {
      setError("Use at least 10 characters for your password.");
      return;
    }

    setPending(true);
    const { data, error: signUpError } = await memberAuthClient.signUp.email({ name, email, password });

    if (signUpError) {
      setPending(false);
      setError(
        signUpError.status === 422
          ? "That email is already registered. Try signing in instead."
          : "We could not create that account. Check your details and try again.",
      );
      return;
    }

    // Only stop at the inbox when a confirmation email can actually be sent.
    // Without a delivery provider the account is already usable.
    if (requiresVerification && data && "user" in data && data.user && !data.user.emailVerified) {
      setNeedsVerification(true);
      setPending(false);
      return;
    }

    router.push("/onboarding");
    router.refresh();
  }

  if (needsVerification) {
    return (
      <AuthCard
        title="Check your inbox"
        subtitle={`We sent a confirmation link to ${email}. Open it to activate your workspace.`}
        footer={
          <Link href="/signin" className="text-mk-accent underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        }
      >
        <p className="text-sm leading-relaxed text-mk-muted">
          The link expires in one hour. If it does not arrive, check your spam folder.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle="Research filings, insider activity and signals in one workspace."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/signin" className="text-mk-accent underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <FormError message={error} />
        <div>
          <label htmlFor={nameId} className={labelClass}>
            Name
          </label>
          <input
            id={nameId}
            type="text"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
            placeholder="Alex Mercer"
          />
        </div>
        <div>
          <label htmlFor={emailId} className={labelClass}>
            Email
          </label>
          <input
            id={emailId}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label htmlFor={passwordId} className={labelClass}>
            Password
          </label>
          <input
            id={passwordId}
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
            aria-describedby={`${passwordId}-hint`}
          />
          <p id={`${passwordId}-hint`} className="mt-1.5 text-xs text-mk-dim">
            At least 10 characters.
          </p>
        </div>
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? "Creating account" : "Create account"}
        </button>
      </form>
    </AuthCard>
  );
}

export function ForgotPasswordForm() {
  const emailId = useId();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    await memberAuthClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    setPending(false);
    setSent(true);
  }

  if (sent) {
    return (
      <AuthCard
        title="Check your inbox"
        subtitle="If that address has an account, a reset link is on its way."
        footer={
          <Link href="/signin" className="text-mk-accent underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        }
      >
        <p className="text-sm leading-relaxed text-mk-muted">
          The link expires in one hour. Nothing arrived? Check your spam folder or try again.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Reset your password"
      subtitle="Enter your email and we will send a link to choose a new password."
      footer={
        <Link href="/signin" className="text-mk-accent underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div>
          <label htmlFor={emailId} className={labelClass}>
            Email
          </label>
          <input
            id={emailId}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            placeholder="you@example.com"
          />
        </div>
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? "Sending" : "Send reset link"}
        </button>
      </form>
    </AuthCard>
  );
}

export function ResetPasswordForm({ token }: { token?: string }) {
  const router = useRouter();
  const passwordId = useId();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!token) {
    return (
      <AuthCard
        title="Link expired"
        subtitle="That reset link is missing or no longer valid."
        footer={
          <Link href="/forgot-password" className="text-mk-accent underline-offset-4 hover:underline">
            Request a new link
          </Link>
        }
      >
        <p className="text-sm leading-relaxed text-mk-muted">Request a fresh link to choose a new password.</p>
      </AuthCard>
    );
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < 10) {
      setError("Use at least 10 characters for your password.");
      return;
    }

    setPending(true);
    const { error: resetError } = await memberAuthClient.resetPassword({ newPassword: password, token });

    if (resetError) {
      setPending(false);
      setError("That link is no longer valid. Request a new one.");
      return;
    }

    router.push("/signin");
    router.refresh();
  }

  return (
    <AuthCard title="Choose a new password" subtitle="Pick something you have not used before.">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <FormError message={error} />
        <div>
          <label htmlFor={passwordId} className={labelClass}>
            New password
          </label>
          <input
            id={passwordId}
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={cn(inputClass)}
          />
          <p className="mt-1.5 text-xs text-mk-dim">At least 10 characters.</p>
        </div>
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? "Saving" : "Save password"}
        </button>
      </form>
    </AuthCard>
  );
}
