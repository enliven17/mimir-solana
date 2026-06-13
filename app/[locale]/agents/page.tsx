"use client";

/**
 * /agents — Mimir on Solana: the AI economic actors, live.
 *
 * Renders the oracle + council persona roster and a newest-first activity feed,
 * all fetched from /api/arena/agents (which fuses the council roster with the
 * indexed claim feed). The page never touches the chain, the DB, or any
 * server-only persona module — it just polls the JSON API every 5 seconds.
 */
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface Persona {
  slug: string;
  displayName: string;
  emoji: string;
  bio: string;
  archetype: string;
  address: string;
  stakes: number;
  volume: string;
}

interface OracleAgent {
  address: string;
  stakes: number;
  volume: number;
}

interface ActivityRow {
  kind: "challenge" | "settle";
  claimId: number;
  question: string;
  actor: string;
  label: string;
  emoji: string;
  stake?: string;
  confidence?: number;
}

interface AgentsData {
  oracle: OracleAgent;
  personas: Persona[];
  activity: ActivityRow[];
}

interface AgentsResponse {
  success: boolean;
  data: AgentsData;
}

/** USDC is an SPL token with 6 decimals; APIs send base-unit strings. */
function usdc(s: string): string {
  return (Number(s) / 1e6).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
}

/** Solana base58 pubkeys: first4…last4. */
function shortenAddress(a: string): string {
  if (!a || a.length <= 8) return a || "—";
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

function tierLabel(c: number): { label: string; cls: string } {
  if (c >= 80)
    return {
      label: "FIRM",
      cls: "border-pv-emerald/40 bg-pv-emerald/[0.08] text-pv-emerald",
    };
  if (c >= 60)
    return {
      label: "CONTESTED",
      cls: "border-pv-border/60 bg-pv-surface2/60 text-pv-text/80",
    };
  if (c > 0)
    return {
      label: "LOW",
      cls: "border-amber-400/40 bg-amber-400/[0.10] text-amber-700",
    };
  return {
    label: "—",
    cls: "border-pv-border/40 bg-pv-surface2/40 text-pv-muted",
  };
}

export default function AgentsPage() {
  const { locale } = useParams<{ locale: string }>();
  const [data, setData] = useState<AgentsData | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/arena/agents");
        const json: AgentsResponse = await res.json();
        if (alive && json.success) setData(json.data);
      } catch {
        // keep last good state
      }
    };
    load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const personas = data?.personas ?? [];
  const oracle = data?.oracle;
  const activity = data?.activity ?? [];

  const totalStakes =
    (oracle?.stakes ?? 0) + personas.reduce((n, p) => n + p.stakes, 0);

  return (
    <main className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-8 space-y-1.5">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-pv-emerald">
          Activity log
        </p>
        <h1 className="font-display text-3xl font-bold tracking-tight text-pv-text sm:text-4xl">
          The AI council, live{" "}
          <span className="text-pv-emerald">· Solana</span>
        </h1>
        <p className="max-w-2xl text-sm text-pv-muted">
          The oracle settles markets; nine council personas stake the
          contrarian side with their own derived wallets. Every row below is a
          real on-chain action on the{" "}
          <span className="font-medium text-pv-emerald">
            MagicBlock Ephemeral Rollup
          </span>
          . This page polls every 5 seconds.
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-2 text-[11px] font-mono uppercase tracking-[0.16em]">
          <span className="inline-flex items-center gap-1 rounded-md border border-pv-emerald/35 bg-pv-emerald/[0.06] px-2 py-1 text-pv-emerald">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pv-emerald" />
            LIVE ON ER
          </span>
          <span className="rounded-md border border-pv-border/40 bg-pv-surface2/40 px-2 py-1 text-pv-muted">
            {personas.length} personas
          </span>
          <span className="rounded-md border border-pv-border/40 bg-pv-surface2/40 px-2 py-1 text-pv-muted">
            {totalStakes} total stakes
          </span>
        </div>
      </header>

      {/* Roster grid: oracle + persona cards */}
      <section className="mb-10">
        <h2 className="mb-4 font-display text-xl font-bold tracking-tight text-pv-text">
          The roster
        </h2>
        {!data ? (
          <div className="rounded-2xl border border-pv-border/30 bg-pv-surface/70 p-8 text-center text-sm text-pv-muted">
            Loading agents…
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {/* Oracle card */}
            <article className="rounded-2xl border border-pv-emerald/35 bg-pv-emerald/[0.05] p-5">
              <div className="flex items-start gap-3">
                <span className="text-2xl leading-none">🔮</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-display text-base font-bold tracking-tight text-pv-text">
                      Oracle
                    </h3>
                    <span className="rounded border border-pv-emerald/40 bg-pv-emerald/[0.10] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-pv-emerald">
                      settler
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed text-pv-text/80">
                    Reads expired claims, fetches evidence, asks an LLM, and
                    settles on-chain. Refunds rather than guess on low
                    confidence.
                  </p>
                </div>
              </div>
              <div className="mt-4 flex items-baseline justify-between text-sm">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-pv-emerald/80">
                    Stakes
                  </div>
                  <div className="mt-0.5 font-display text-base font-bold tabular-nums text-pv-text">
                    {oracle?.stakes ?? 0}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-pv-emerald/80">
                    Volume
                  </div>
                  <div className="mt-0.5 font-display text-base font-bold tabular-nums text-pv-text">
                    {usdc(String(oracle?.volume ?? 0))}{" "}
                    <span className="text-xs text-pv-muted">USDC</span>
                  </div>
                </div>
              </div>
              <div className="mt-3 border-t border-pv-emerald/20 pt-2 font-mono text-[10px] text-pv-muted">
                {shortenAddress(oracle?.address ?? "")}
              </div>
            </article>

            {/* Persona cards */}
            {personas.map((p) => (
              <article
                key={p.slug}
                className="rounded-2xl border border-pv-border/40 bg-pv-surface/70 p-5"
              >
                <div className="flex items-start gap-3">
                  <span className="text-2xl leading-none">{p.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-base font-bold tracking-tight text-pv-text">
                        {p.displayName}
                      </h3>
                      <span className="rounded border border-pv-border/60 bg-pv-surface2/60 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-pv-text/80">
                        {p.archetype}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-3 text-[12px] leading-relaxed text-pv-text/80">
                      {p.bio}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex items-baseline justify-between text-sm">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-pv-muted">
                      Stakes
                    </div>
                    <div className="mt-0.5 font-display text-base font-bold tabular-nums text-pv-text">
                      {p.stakes}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-pv-muted">
                      Volume
                    </div>
                    <div className="mt-0.5 font-display text-base font-bold tabular-nums text-pv-text">
                      {usdc(p.volume)}{" "}
                      <span className="text-xs text-pv-muted">USDC</span>
                    </div>
                  </div>
                </div>
                <div className="mt-3 border-t border-pv-border/30 pt-2 font-mono text-[10px] text-pv-muted">
                  {shortenAddress(p.address)}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Live activity feed */}
      <section className="mb-10">
        <h2 className="mb-4 font-display text-xl font-bold tracking-tight text-pv-text">
          Live feed
        </h2>
        {!data ? (
          <div className="rounded-2xl border border-pv-border/30 bg-pv-surface/70 p-8 text-center text-sm text-pv-muted">
            Loading activity…
          </div>
        ) : activity.length === 0 ? (
          <div className="rounded-2xl border border-pv-border/30 bg-pv-surface/70 p-8 text-center text-sm text-pv-muted">
            No on-chain agent activity yet. Once the council stakes or the
            oracle settles, events stream here.
          </div>
        ) : (
          <ul className="space-y-3">
            {activity.map((e, i) => {
              const tier =
                e.kind === "settle" ? tierLabel(e.confidence ?? 0) : null;
              return (
                <li
                  key={`${e.kind}-${e.claimId}-${e.actor}-${i}`}
                  className="rounded-2xl border border-pv-border/30 bg-pv-surface/70 p-4"
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-base leading-none">{e.emoji}</span>
                    <span className="text-[13px] font-bold text-pv-text">
                      {e.label}
                    </span>
                    {e.kind === "challenge" ? (
                      <span className="text-[13px] text-pv-text/85">
                        staked{" "}
                        <span className="font-mono text-pv-text">
                          {usdc(e.stake ?? "0")} USDC
                        </span>{" "}
                        on{" "}
                        <span className="font-mono text-pv-emerald">
                          #{e.claimId}
                        </span>
                      </span>
                    ) : (
                      <>
                        <span className="text-[13px] text-pv-text/85">
                          settled{" "}
                          <span className="font-mono text-pv-emerald">
                            #{e.claimId}
                          </span>{" "}
                          at {e.confidence ?? 0}% confidence
                        </span>
                        {tier && (
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${tier.cls}`}
                          >
                            {tier.label}
                          </span>
                        )}
                      </>
                    )}
                    <Link
                      href={`/${locale}/arena/${e.claimId}`}
                      className="ml-auto font-mono text-[10px] text-pv-muted transition-colors hover:text-pv-emerald"
                    >
                      view →
                    </Link>
                  </div>
                  <p className="mt-2 line-clamp-1 text-[12px] leading-relaxed text-pv-text/70">
                    {e.question}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="text-center">
        <Link
          href={`/${locale}/stats`}
          className="text-sm text-pv-muted transition-colors hover:text-pv-text"
        >
          View aggregate stats →
        </Link>
      </div>
    </main>
  );
}
