import "server-only";

/**
 * Pool options for a Postgres connection string.
 *
 * `pg` 8.23 warns that `sslmode=require` is currently an alias for
 * `verify-full`, but will adopt weaker libpq semantics in v9. Rather than
 * inherit whichever side of that change we happen to land on, the mode is
 * removed from the URL and TLS is configured explicitly: full certificate
 * verification for any remote host, no TLS for a local one.
 *
 * Removing the parameter is what silences the warning. Passing an explicit
 * `ssl` object is not enough on its own, because `pg` parses the connection
 * string before it looks at the options.
 */
export function pgPoolConfig(connectionString: string | undefined) {
  if (!connectionString) {
    return {};
  }

  const isLocal = /(^|@)(localhost|127\.0\.0\.1)/.test(connectionString);
  const wantsTls = !isLocal || /[?&]sslmode=(?!disable)/i.test(connectionString);

  return {
    connectionString: withoutSslMode(connectionString),
    ssl: wantsTls ? { rejectUnauthorized: true } : undefined,
  };
}

/**
 * Drops `sslmode` from the query string without re-serialising the URL, so a
 * password containing characters that `URL` would re-encode survives intact.
 */
function withoutSslMode(connectionString: string): string {
  const queryStart = connectionString.indexOf("?");
  if (queryStart === -1) {
    return connectionString;
  }

  const base = connectionString.slice(0, queryStart);
  const [query, hash] = connectionString.slice(queryStart + 1).split("#", 2);
  const kept = query.split("&").filter((param) => param && !/^sslmode=/i.test(param));
  const suffix = hash ? `#${hash}` : "";

  return kept.length > 0 ? `${base}?${kept.join("&")}${suffix}` : `${base}${suffix}`;
}
