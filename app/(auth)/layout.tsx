import { Logo } from "@/components/marketing/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mk-shell flex min-h-dvh flex-col">
      <header className="px-5 py-5 sm:px-8">
        <Logo />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-8 sm:py-12">{children}</main>
      <footer className="px-5 py-6 text-center font-marketing-mono text-[11px] uppercase tracking-[0.14em] text-mk-dim">
        Research, not advice
      </footer>
    </div>
  );
}
