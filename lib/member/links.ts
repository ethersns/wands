import type { SavedItem } from "./saved";

/**
 * Every member research link is built here so a saved item, a feed row and a
 * detail view can never disagree about where a record lives.
 */

export function assetHref(symbol: string): string {
  return `/app/assets/${encodeURIComponent(symbol.trim().toUpperCase())}`;
}

export function signalHref(id: string): string {
  return `/app/signals/${encodeURIComponent(id)}`;
}

export function filingHref(id: string): string {
  return `/app/insiders/${encodeURIComponent(id)}`;
}

/**
 * Where a saved item reopens. A saved asset reopens its research page; a saved
 * signal or filing reopens its detail view, which falls back to the asset page
 * when the engine no longer serves that record.
 */
export function savedHref(item: Pick<SavedItem, "kind" | "refId" | "symbol">): string {
  switch (item.kind) {
    case "asset":
      return assetHref(item.symbol ?? item.refId);
    case "signal":
      return signalHref(item.refId);
    case "insider":
    case "filing":
      return filingHref(item.refId);
  }
}
