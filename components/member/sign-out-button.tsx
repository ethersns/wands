"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";

import { memberAuthClient } from "@/lib/auth/member-client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    console.log("[v0] signOut clicked");
    setPending(true);
    const result = await memberAuthClient.signOut();
    console.log("[v0] signOut result", JSON.stringify(result));
    router.push("/");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={pending}
      className="group flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-mk-muted transition-colors hover:bg-mk-surface hover:text-mk-fg disabled:opacity-60"
    >
      <LogOut className="size-4 shrink-0 text-mk-dim group-hover:text-mk-muted" aria-hidden />
      {pending ? "Signing out" : "Sign out"}
    </button>
  );
}
