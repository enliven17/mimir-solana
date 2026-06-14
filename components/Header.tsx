"use client";

/**
 * Mimir header — Solana-native.
 * Wallet connection is handled by @solana/wallet-adapter (WalletMultiButton);
 * the nav points at the arena product surface. No EVM / wagmi anywhere.
 */
import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { Link, usePathname } from "@/i18n/navigation";
import { Menu, X } from "lucide-react";
import ThemeToggle from "./ThemeToggle";

// wallet-adapter button is client-only (touches window) — load without SSR.
const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false }
);

const NAV: { href: "/arena" | "/stats" | "/agents" | "/docs"; label: string }[] = [
  { href: "/arena", label: "Arena ⚡" },
  { href: "/stats", label: "Stats" },
  { href: "/agents", label: "Agents" },
  { href: "/docs", label: "Docs" },
];

export default function Header() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-2 pt-[env(safe-area-inset-top)] sm:px-4">
      <nav
        className={`mx-auto flex h-14 max-w-[1100px] items-center justify-between px-4 transition-all duration-300 ease-out sm:px-6 ${
          scrolled || mobileOpen
            ? "mt-2 rounded-2xl border border-pv-border/40 bg-pv-surface/70 shadow-[0_10px_40px_-12px_rgba(216,95,95,0.18)] backdrop-blur-[18px] sm:mt-3"
            : "mt-0 border border-transparent bg-transparent"
        }`}
      >
        <Link href="/" className="flex items-center gap-2.5">
          <span className="group font-display text-lg font-bold tracking-tight text-pv-emerald sm:text-xl">
            Mimir
            <span className="ml-[1px] text-pv-text" aria-hidden>
              .
            </span>
          </span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden items-center gap-5 md:flex">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`font-mono text-[13px] font-medium transition-colors focus-ring ${
                  active ? "text-pv-emerald" : "text-pv-text/75 hover:text-pv-emerald"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
          <ThemeToggle />
          <WalletMultiButton />
        </div>

        {/* Mobile controls */}
        <div className="flex items-center gap-2 md:hidden">
          <ThemeToggle />
          <button
            className="text-pv-text"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </nav>

      {mobileOpen && (
        <div className="mx-auto mt-2 max-w-[1100px] rounded-2xl border border-pv-border/40 bg-pv-surface/90 p-4 backdrop-blur-[18px] md:hidden">
          <div className="flex flex-col gap-3">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="font-mono text-sm text-pv-text/85 hover:text-pv-emerald"
              >
                {item.label}
              </Link>
            ))}
            <div className="pt-2">
              <WalletMultiButton />
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
