/**
 * The shape a control-centre server action returns.
 *
 * Kept in its own module because a `"use server"` file may only export async
 * functions, and both the action and the dialog that renders its result need
 * this type.
 */
export interface ActionState {
  ok: boolean;
  message: string;
}
