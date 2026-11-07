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

export function savedItemHref(id: string): string {
  return `/app/saved/${encodeURIComponent(id)}`;
}

/**
 * Where a saved item reopens: its own saved record, addressed by the stable id
 * the member's library assigned it.
 *
 * A saved record is not the live record. The engine's feeds are windowed, so a
 * filing saved months ago may no longer appear in them, and a saved signal may
 * have been superseded. Reopening the saved record always works, and that page
 * links out to the live record when the engine still serves it.
 */
export function savedHref(item: Pick<SavedItem, "id">): string {
  return savedItemHref(item.id);
}
