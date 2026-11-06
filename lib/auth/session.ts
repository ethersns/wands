/**
 * Operator session for the BFF.
 *
 * The browser never holds the engine token, but the proxy route does — which
 * makes an unauthenticated `/api/wands/*` an open admin channel to the engine.
 * This module issues and verifies a signed, HttpOnly cookie so only an operator
 * who knows the shared password can drive those routes.
 *
 * Web Crypto only, so the same code runs in middleware and in route handlers.
 */

export const SESSION_COOKIE = "wands_operator";
export const SESSION_TTL_SECONDS = 60 * 60 * 8;

function envValue(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function operatorPassword(): string | null {
  return envValue("WANDS_OPERATOR_PASSWORD");
}

export function sessionSecret(): string | null {
  return envValue("WANDS_SESSION_SECRET");
}

/** True when the deployment has configured both halves of the gate. */
export function gateConfigured(): boolean {
  return operatorPassword() !== null && sessionSecret() !== null;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return toBase64Url(new Uint8Array(signature));
}

/** Compares equal-length digests without an early exit. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

export async function createSessionToken(nowMs = Date.now()): Promise<string | null> {
  const secret = sessionSecret();
  if (!secret) return null;
  const expiresAt = Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS;
  const payload = `v1.${expiresAt}`;
  return `${payload}.${await sign(payload, secret)}`;
}

export async function verifySessionToken(
  token: string | undefined,
  nowMs = Date.now(),
): Promise<boolean> {
  const secret = sessionSecret();
  if (!secret || !token) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;

  const [version, expiresAt, signature] = parts;
  if (version !== "v1") return false;

  const expiry = Number(expiresAt);
  if (!Number.isFinite(expiry) || expiry * 1000 <= nowMs) return false;

  const expected = await sign(`${version}.${expiresAt}`, secret);
  return timingSafeEqual(signature, expected);
}

/**
 * Compares the submitted password against the configured one by hashing both
 * first, so the comparison is over equal-length digests and cannot leak the
 * password's length through timing.
 */
export async function checkPassword(candidate: string): Promise<boolean> {
  const expected = operatorPassword();
  const secret = sessionSecret();
  if (!expected || !secret) return false;

  const [submitted, configured] = await Promise.all([
    sign(candidate, secret),
    sign(expected, secret),
  ]);
  return timingSafeEqual(submitted, configured);
}
