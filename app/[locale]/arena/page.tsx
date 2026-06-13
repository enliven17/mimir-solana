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
import Link from "next/link";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

interface ArenaClaim {
  id: number;
  question: string;
  category: string;
  creatorStake: string;
  totalChallengerStake: string;
  deadline: number;
  state: number;
  winnerSide: number;
  confidence: number;
  delegated: boolean;
  challengers: { addr: string; stake: string; paid: boolean }[];
}

const STATE_LABELS = ["OPEN", "ACTIVE", "RESOLVED", "CANCELLED"] as const;

function usdc(units: string): string {
  return (Number(units) / 1e6).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
}

function timeLeft(deadline: number): string {
  const s = deadline - Math.floor(Date.now() / 1000);
  if (s <= 0) return "expired";
  if (s < 90) return `${s}s`;
  if (s < 5400) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}

export default function ArenaPage() {
  const { locale } = useParams<{ locale: string }>();
  const [claims, setClaims] = useState<ArenaClaim[] | null>(null);
  const [stats, setStats] = useState({ claimCount: 0, totalResolved: 0 });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/arena/claims");
        const json = await res.json();
        if (alive && json.success) {
          setClaims(json.data.claims);
          setStats({
            claimCount: json.data.claimCount,
            totalResolved: json.data.totalResolved,
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Arena <span className="text-violet-500">· Solana</span>
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Claims live inside a{" "}
            <span className="font-medium text-violet-500">
              MagicBlock Ephemeral Rollup
            </span>{" "}
            — challenges are zero-fee and land in ~30ms. Price claims resolve
            against the{" "}
            <span className="font-medium text-amber-500">Flash Trade</span>{" "}
            oracle.
          </p>
        </div>
        <WalletMultiButton />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Markets", stats.claimCount],
          ["Resolved", stats.totalResolved],
          [
            "Live on ER",
            claims?.filter((c) => c.delegated).length ?? "…",
          ],
          [
            "Open pool",
            claims
              ? `$${usdc(
                  claims
                    .filter((c) => c.state <= 1)
                    .reduce(
                      (sum, c) =>
                        sum +
                        Number(c.creatorStake) +
                        Number(c.totalChallengerStake),
                      0
                    )
                    .toString()
                )}`
              : "…",
          ],
        ].map(([label, value]) => (
          <div
            key={label as string}
            className="rounded-xl border border-neutral-200/60 bg-white/50 p-4 dark:border-neutral-800 dark:bg-neutral-900/50"
          >
            <div className="text-xs uppercase tracking-wide text-neutral-500">
              {label}
            </div>
            <div className="mt-1 text-xl font-semibold">{value}</div>
          </div>
        ))}
      </div>

      {!claims ? (
        <div className="py-16 text-center text-neutral-500">
          Loading on-chain markets…
        </div>
      ) : claims.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 py-16 text-center text-neutral-500 dark:border-neutral-700">
          No markets yet. Run the market-creator agent:
          <code className="ml-2 rounded bg-neutral-100 px-2 py-1 text-xs dark:bg-neutral-800">
            npm run market-creator:solana
          </code>
        </div>
      ) : (
        <div className="grid gap-3">
          {claims.map((c) => (
            <Link
              key={c.id}
              href={`/${locale}/arena/${c.id}`}
              className="group rounded-xl border border-neutral-200/60 bg-white/50 p-4 transition hover:border-violet-400/60 dark:border-neutral-800 dark:bg-neutral-900/50"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-medium uppercase tracking-wide text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                      {c.category}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 font-medium ${
                        c.state === 2
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                          : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                      }`}
                    >
                      {STATE_LABELS[c.state]}
                    </span>
                    {c.delegated && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 font-semibold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-500" />
                        LIVE ON ER
                      </span>
                    )}
                  </div>
                  <h2 className="mt-2 font-medium leading-snug group-hover:text-violet-500">
                    {c.question}
                  </h2>
                </div>
                <div className="shrink-0 text-right text-sm">
                  <div className="font-semibold">
                    ${usdc(
                      (
                        Number(c.creatorStake) + Number(c.totalChallengerStake)
                      ).toString()
                    )}{" "}
                    <span className="text-xs font-normal text-neutral-500">
                      pool
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-neutral-500">
                    {c.challengers.length} challenger
                    {c.challengers.length === 1 ? "" : "s"} ·{" "}
                    {c.state <= 1 ? `closes ${timeLeft(c.deadline)}` : "settled"}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
