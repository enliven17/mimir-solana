"use client";

/**
 * Council verdict panel for the arena claim-detail page. Shows where each AI
 * council persona stands on this claim: ✓ if its wallet staked the challenger
 * side, — abstain otherwise. Persona wallets come from /api/arena/agents; the
 * stake match is done against the claim's on-chain challenger list.
 */
import { useEffect, useState } from "react";

interface RosterPersona {
  slug: string;
  displayName: string;
  emoji: string;
  archetype: string;
  address: string;
}

interface Challenger {
  addr: string;
  stake: string;
  paid: boolean;
}

const ARCHETYPE_LABEL: Record<string, string> = {
  "llm-biased": "LLM · biased",
  "rule-based": "Rule · no LLM",
  specialist: "Specialist",
  micro: "Micro · low threshold",
};

function usdc(units: string | number): string {
  return (Number(units) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export default function CouncilVotes({ challengers }: { challengers: Challenger[] }) {
  const [roster, setRoster] = useState<RosterPersona[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/arena/agents")
      .then((r) => r.json())
      .then((j) => {
        if (alive && j.success) setRoster(j.data.personas as RosterPersona[]);
      })
      .catch(() => {
        /* fail-quiet: the detail page still works without this panel */
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!roster || roster.length === 0) return null;

  const stakeByAddr = new Map(challengers.map((c) => [c.addr, c]));
  const votes = roster
    .map((p) => ({ persona: p, ch: p.address ? stakeByAddr.get(p.address) : undefined }))
    // staked personas first, then abstainers — both alphabetical-ish by roster order
    .sort((a, b) => (a.ch ? 0 : 1) - (b.ch ? 0 : 1));

  const stakedCount = votes.filter((v) => v.ch).length;
  const totalUsdc = votes.reduce((s, v) => s + (v.ch ? Number(v.ch.stake) : 0), 0);

  return (
    <section className="card border-black/[0.12] bg-pv-surface p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-pv-emerald">
            Council verdict
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-pv-muted">
            Where each of the {roster.length} AI personas stands. ✓ means they staked the
            challenger side in the Ephemeral Rollup.
          </p>
        </div>
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-pv-muted">
          {stakedCount}/{roster.length} staked · {usdc(totalUsdc)} USDC
        </div>
      </div>

      <ul className="grid gap-1.5">
        {votes.map(({ persona: v, ch }) => (
          <li
            key={v.slug}
            className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
              ch
                ? "border-pv-emerald/35 bg-pv-emerald/[0.06]"
                : "border-black/[0.1] bg-black/[0.02]"
            }`}
          >
            <span className="shrink-0 text-base leading-none">{v.emoji}</span>
            <div className="flex min-w-0 flex-1 items-baseline gap-2">
              <span
                className={`truncate text-[13px] font-semibold ${
                  ch ? "text-pv-text" : "text-pv-muted"
                }`}
              >
                {v.displayName}
              </span>
              <span className="hidden shrink-0 font-mono text-[9px] uppercase tracking-[0.1em] text-pv-muted/60 sm:inline">
                {ARCHETYPE_LABEL[v.archetype] ?? v.archetype}
              </span>
            </div>
            {ch ? (
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-pv-emerald">
                ✓ {usdc(ch.stake)} USDC
              </span>
            ) : (
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-pv-muted/60">
                abstain
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
