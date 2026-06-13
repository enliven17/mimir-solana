"use client";

/**
 * /arena — Mimir on Solana: live market feed.
 *
 * Claims delegated to the MagicBlock Ephemeral Rollup carry a pulsing
 * "LIVE ON ER" badge — challenges against them are zero-fee and land in
 * ~30ms. The feed itself polls every 4s, so council bets appear almost
 * as they happen.
 */
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ClaimCard, { type SolanaClaim } from "@/components/arena/ClaimCard";

function usdc(units: string): string {
  return (Number(units) / 1e6).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
}

interface ArenaData {
  claims: SolanaClaim[];
  claimCount: number;
  totalResolved: number;
  openPool: string;
}

export default function ArenaPage() {
  const { locale } = useParams<{ locale: string }>();
  const [claims, setClaims] = useState<SolanaClaim[] | null>(null);
  const [stats, setStats] = useState({
    claimCount: 0,
    totalResolved: 0,
    openPool: "0",
  });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/arena/claims");
        const json = await res.json();
        if (alive && json.success) {
          const data = json.data as ArenaData;
          setClaims(data.claims);
          setStats({
            claimCount: data.claimCount,
            totalResolved: data.totalResolved,
            openPool: data.openPool,
          });
        }
      } catch {
        // keep last good state
      }
    };
    load();
    const t = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const liveOnEr = claims?.filter((c) => c.delegated).length;

  const tiles: { label: string; value: string | number }[] = [
    { label: "Markets", value: stats.claimCount },
    { label: "Resolved", value: stats.totalResolved },
    { label: "Live on ER", value: liveOnEr ?? "…" },
    {
      label: "Open pool",
      value: claims ? `$${usdc(stats.openPool)}` : "…",
    },
  ];

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <h1 className="font-display text-3xl font-bold uppercase tracking-tight text-pv-text sm:text-4xl">
          Arena <span className="text-pv-emerald">· Solana</span>
        </h1>
        <p className="max-w-2xl font-body text-sm leading-relaxed text-pv-muted">
          Claims live inside a{" "}
          <span className="font-bold text-pv-emerald">
            MagicBlock Ephemeral Rollup
          </span>{" "}
          — challenges are zero-fee and land in ~30ms. Price claims resolve
          against the <span className="font-bold text-pv-gold">Flash Trade</span>{" "}
          oracle.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className="rounded border border-black/[0.1] bg-pv-surface px-4 py-3"
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-pv-muted">
              {tile.label}
            </div>
            <div className="mt-1 font-display text-xl font-bold tabular-nums text-pv-text">
              {tile.value}
            </div>
          </div>
        ))}
      </div>

      {!claims ? (
        <div className="py-16 text-center font-mono text-sm uppercase tracking-[0.16em] text-pv-muted">
          Loading on-chain markets…
        </div>
      ) : claims.length === 0 ? (
        <div className="rounded border border-dashed border-black/[0.15] bg-pv-surface py-16 text-center font-body text-sm text-pv-muted">
          No markets yet. Run the market-creator agent:
          <code className="ml-2 rounded bg-black/[0.04] px-2 py-1 font-mono text-xs text-pv-text">
            npm run market-creator:solana
          </code>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          {claims.map((c) => (
            <ClaimCard key={c.id} claim={c} locale={locale} />
          ))}
        </div>
      )}
    </div>
  );
}
