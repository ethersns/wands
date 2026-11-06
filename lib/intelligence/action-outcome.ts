/**
 * The engine's answer to an administrative research action.
 *
 * Kept in its own module so the presentation layer can render an outcome
 * without importing the server action that produced it.
 */
export interface ActionOutcome {
  ok: boolean;
  title: string;
  message: string;
  detail: string[];
  at: string;
}
