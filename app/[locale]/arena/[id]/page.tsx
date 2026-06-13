"use client";

/**
 * /arena/[id] — claim detail + the three-step challenge flow:
 *   1. deposit USDC into the Mimir escrow vault   (base layer, one-time)
 *   2. delegate the balance PDA to the ER          (base layer, one-time)
 *   3. challenge                                   (Ephemeral Rollup, ~30ms)
 *
 * Steps 1–2 only happen the first time; after that every bet is instant.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  createBrowserMimir,
  depositUsdc,
  delegateBalance,
  challengeInER,
  getVirtualBalance,
} from "@/lib/solana/browser-client";

interface ArenaClaim {
  id: number;
  creator: string;
  question: string;
  creatorPosition: string;
  counterPosition: string;
  resolutionUrl: string;
  category: string;
  creatorStake: string;
  totalChallengerStake: string;
  deadline: number;
  state: number;
  winnerSide: number;
  resolutionSummary: string;
  confidence: number;
  maxChallengers?: number;
  delegated: boolean;
  challengers: { addr: string; stake: string; paid: boolean }[];
}

const SIDE_LABELS = ["—", "Creator wins", "Challengers win", "Draw — refunded", "Unresolvable — refunded"];
const STATE_LABELS = ["OPEN", "LIVE", "PROVEN", "CANCELLED"];

function usdc(units: string | number): string {
  return (Number(units) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function shorten(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}

function confidenceTone(c: number): { label: string; cls: string } {
  if (c >= 80) return { label: "FIRM · high confidence", cls: "border-pv-emerald/40 bg-pv-emerald/[0.08] text-pv-emerald" };
  if (c >= 60) return { label: "CONTESTED · medium confidence", cls: "border-black/[0.14] bg-pv-surface2/60 text-pv-text/80" };
  return { label: "REFUNDED · low confidence", cls: "border-pv-gold/40 bg-pv-gold/[0.10] text-pv-gold" };
}

export default function ArenaClaimPage() {
  const params = useParams<{ id: string; locale: string }>();
  const wallet = useWallet();
  const [claim, setClaim] = useState<ArenaClaim | null>(null);
  const [stake, setStake] = useState("2");
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [balance, setBalance] = useState<bigint>(0n);

  const mimir = useMemo(() => createBrowserMimir(wallet), [wallet.publicKey, wallet.signTransaction]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/arena/claims");
      const json = await res.json();
      if (json.success) {
        const found = json.data.claims.find((c: ArenaClaim) => c.id === Number(params.id));
        if (found) setClaim(found);
      }
    } catch {}
    if (mimir) {
      try {
        setBalance(await getVirtualBalance(mimir));
      } catch {}
    }
  }, [params.id, mimir]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const pushLog = (s: string) => setLog((l) => [...l, s]);

  const onChallenge = async () => {
    if (!mimir || !claim) return;
    const units = BigInt(Math.round(Number(stake) * 1e6));
    setLog([]);
    try {
      if (balance < units) {
        setBusy("Depositing USDC into the Mimir vault (base layer)…");
        const depositAmount = units > 20_000_000n ? units : 20_000_000n; // top up at least 20 USDC
        await depositUsdc(mimir, depositAmount);
        pushLog(`✓ Deposited ${usdc(depositAmount.toString())} USDC into escrow`);
        setBusy("Delegating your balance to the MagicBlock ER…");
        await delegateBalance(mimir);
        pushLog("✓ Balance PDA delegated — you can now bet in real time");
        await new Promise((r) => setTimeout(r, 2500));
      }
      setBusy("Challenging inside the Ephemeral Rollup…");
      const t0 = Date.now();
      const sig = await challengeInER(mimir, BigInt(claim.id), units);
      pushLog(`⚡ Challenge landed in ${Date.now() - t0}ms — zero fee (${sig.slice(0, 20)}…)`);
      await refresh();
    } catch (err: any) {
      pushLog(`✗ ${err?.message ?? err}`);
    } finally {
      setBusy(null);
    }
  };

  if (!claim) {
    return (
      <div className="py-20 text-center">
        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-transparent border-t-pv-emerald" />
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-pv-muted">Loading claim…</p>
      </div>
    );
  }

  const expired = claim.deadline <= Math.floor(Date.now() / 1000);
  const creatorStakeNum = Number(claim.creatorStake);
  const challengerStakeNum = Number(claim.totalChallengerStake);
  const pool = creatorStakeNum + challengerStakeNum;
  const challengerFillPct = pool > 0 ? Math.max(4, Math.min(96, (challengerStakeNum / pool) * 100)) : 50;
  const maxChallengers = claim.maxChallengers && claim.maxChallengers > 0 ? claim.maxChallengers : 1;
  const isFlashOracle = claim.resolutionUrl.includes("flashapi.trade");
  const resolutionHref = claim.resolutionUrl.startsWith("http")
    ? claim.resolutionUrl
    : `https://${claim.resolutionUrl}`;
  const isResolved = claim.state === 2;
  const isCancelled = claim.state === 3;
  const conf = confidenceTone(claim.confidence);

  const statePillCls = isResolved
    ? "border-pv-emerald/35 bg-pv-emerald/[0.10] text-pv-emerald"
    : claim.state === 0
      ? "border-black/[0.12] bg-black/[0.04] text-pv-muted"
      : isCancelled
        ? "border-black/[0.12] bg-black/[0.04] text-pv-muted"
        : "border-pv-fuch/35 bg-pv-fuch/[0.10] text-pv-fuch";

  return (
    <div className="relative z-[1] mx-auto w-full max-w-4xl px-4 pb-16 pt-2 sm:px-6 sm:pb-20 sm:pt-4">
      {/* Top bar */}
      <div className="mb-6 flex items-center justify-between gap-4 sm:mb-8">
        <Link
          href={`/${params.locale}/arena`}
          className="inline-flex items-center gap-2 rounded-lg border border-transparent px-2 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-pv-muted transition-[color,border-color,background-color] hover:border-black/[0.1] hover:bg-black/[0.04] hover:text-pv-text sm:text-[11px]"
        >
          ← Arena
        </Link>
        <WalletMultiButton />
      </div>

      {/* ── Header / claim card ── */}
      <div className="card mb-6 border-black/[0.12] bg-pv-surface sm:mb-8">
        <div className="p-5 sm:p-8">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="rounded px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-pv-muted ring-1 ring-black/[0.1] bg-black/[0.03]">
                {claim.category}
              </span>
              <span className={`rounded-full border px-2.5 py-1 font-display text-[10px] font-bold uppercase tracking-[0.14em] ${statePillCls}`}>
                {STATE_LABELS[claim.state] ?? "—"}
              </span>
              {claim.delegated && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-pv-fuch/35 bg-pv-fuch/[0.10] px-2.5 py-1 font-display text-[10px] font-bold uppercase tracking-[0.14em] text-pv-fuch shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pv-fuch shadow-[0_0_8px_rgba(200,71,71,0.7)]" />
                  Live on MagicBlock ER
                </span>
              )}
              {isFlashOracle && (
                <span className="inline-flex items-center gap-1 rounded-full border border-pv-gold/35 bg-pv-gold/[0.10] px-2.5 py-1 font-display text-[10px] font-bold uppercase tracking-[0.14em] text-pv-gold">
                  ⚡ Flash Trade oracle
                </span>
              )}
            </div>
            <span className="shrink-0 font-mono text-[11px] text-pv-muted">#{claim.id}</span>
          </div>

          <h1 className="mb-6 font-display text-[clamp(22px,6vw,38px)] font-bold uppercase leading-[0.95] tracking-tight text-pv-text sm:mb-7">
            {claim.question}
          </h1>

          {/* Opposing positions */}
          <div className="mb-6 flex flex-col overflow-hidden rounded-xl border border-black/[0.12] sm:flex-row">
            <div className="flex-1 bg-pv-cyan/[0.04] p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full border border-pv-cyan/30 bg-pv-cyan/[0.08] font-mono text-[10px] font-bold text-pv-cyan">
                  A
                </span>
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-pv-cyan/70 sm:text-[11px]">
                  Creator
                </div>
              </div>
              <div className="font-mono text-xs text-pv-muted">{shorten(claim.creator)}</div>
              <div className="mt-1 text-sm leading-snug text-pv-cyan">{claim.creatorPosition}</div>
              <div className="mt-3 font-mono text-sm font-bold tabular-nums text-pv-text">
                ${usdc(claim.creatorStake)} <span className="text-pv-muted">staked</span>
              </div>
            </div>

            <div
              className="h-px w-full shrink-0 bg-black/[0.06] sm:h-auto sm:w-px sm:self-stretch"
              aria-hidden
            />

            <div className="flex-1 bg-pv-fuch/[0.04] p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full border border-pv-fuch/30 bg-pv-fuch/[0.08] font-mono text-[10px] font-bold text-pv-fuch">
                  B
                </span>
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-pv-fuch/70 sm:text-[11px]">
                  Challengers
                </div>
              </div>
              {claim.challengers.length === 0 ? (
                <div className="py-2 text-xs italic text-pv-muted">Waiting for a rival to challenge…</div>
              ) : (
                <div className="font-mono text-xs text-pv-muted">
                  {claim.challengers.length} wallet{claim.challengers.length === 1 ? "" : "s"} in
                </div>
              )}
              <div className="mt-1 text-sm leading-snug text-pv-fuch">{claim.counterPosition}</div>
              <div className="mt-3 font-mono text-sm font-bold tabular-nums text-pv-text">
                ${usdc(claim.totalChallengerStake)} <span className="text-pv-muted">staked</span>
              </div>
            </div>
          </div>

          {/* Pool fill visualization */}
          <div className="mb-6">
            <div className="mb-2 flex items-center justify-between font-mono text-[10px] font-bold uppercase tracking-[0.16em]">
              <span className="text-pv-cyan">Creator ${usdc(claim.creatorStake)}</span>
              <span className="text-pv-fuch">${usdc(claim.totalChallengerStake)} Challengers</span>
            </div>
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-black/[0.07] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]">
              <div
                className="h-full bg-pv-cyan/70 transition-[width] duration-500 ease-out"
                style={{ width: `${100 - challengerFillPct}%` }}
                aria-hidden
              />
              <div
                className="h-full bg-pv-fuch/70 transition-[width] duration-500 ease-out"
                style={{ width: `${challengerFillPct}%` }}
                aria-hidden
              />
            </div>
          </div>

          {/* Metric strip */}
          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-black/[0.1] bg-black/[0.07] p-px shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex min-h-[5.75rem] min-w-0 flex-col bg-pv-bg/55 px-4 py-3.5 sm:min-h-[6rem]">
              <p className="shrink-0 text-[10px] font-bold uppercase leading-snug tracking-[0.16em] text-pv-muted/90 sm:text-[11px]">
                Pool
              </p>
              <div className="mt-auto min-w-0 pt-2 font-mono text-base font-bold tabular-nums leading-tight text-pv-gold sm:text-lg lg:text-xl">
                ${usdc(pool)}
              </div>
            </div>
            <div className="flex min-h-[5.75rem] min-w-0 flex-col bg-pv-bg/55 px-4 py-3.5 sm:min-h-[6rem]">
              <p className="shrink-0 text-[10px] font-bold uppercase leading-snug tracking-[0.16em] text-pv-muted/90 sm:text-[11px]">
                Creator stake
              </p>
              <div className="mt-auto min-w-0 pt-2 font-mono text-base font-bold tabular-nums leading-tight text-pv-cyan sm:text-lg lg:text-xl">
                ${usdc(claim.creatorStake)}
              </div>
            </div>
            <div className="flex min-h-[5.75rem] min-w-0 flex-col bg-pv-bg/55 px-4 py-3.5 sm:min-h-[6rem]">
              <p className="shrink-0 text-[10px] font-bold uppercase leading-snug tracking-[0.16em] text-pv-muted/90 sm:text-[11px]">
                Deadline
              </p>
              <div className="mt-auto min-w-0 pt-2 font-mono text-sm font-bold leading-tight text-pv-text sm:text-base lg:text-lg">
                {new Date(claim.deadline * 1000).toLocaleString()}
              </div>
            </div>
            <div className="flex min-h-[5.75rem] min-w-0 flex-col bg-pv-bg/55 px-4 py-3.5 sm:min-h-[6rem]">
              <p className="shrink-0 text-[10px] font-bold uppercase leading-snug tracking-[0.16em] text-pv-muted/90 sm:text-[11px]">
                Slots
              </p>
              <div className="mt-auto min-w-0 pt-2 font-mono text-base font-bold tabular-nums leading-tight text-pv-fuch sm:text-lg lg:text-xl">
                {claim.challengers.length}/{maxChallengers}
              </div>
            </div>
          </div>
        </div>

        {/* Footer: oracle note + evidence link */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/[0.08] px-5 py-3 sm:px-8">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-pv-emerald shadow-[0_0_8px_rgba(216,95,95,0.6)]" />
            <span className="text-xs text-pv-muted">
              {isFlashOracle ? "Resolves via the Flash Trade oracle" : "Settled by the Mimir AI oracle"}
            </span>
          </div>
          {claim.resolutionUrl && (
            <a
              href={resolutionHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[10px] text-pv-muted transition-colors hover:text-pv-cyan"
            >
              ↗ source
            </a>
          )}
        </div>
      </div>

      {/* ── State-specific section ── */}
      {isResolved ? (
        // Settlement receipt
        <div className="card border-black/[0.12] bg-pv-surface">
          <div className="p-5 sm:p-6">
            <div className="mb-5 flex min-w-0 items-start gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pv-emerald/10 text-pv-emerald" aria-hidden>
                ✶
              </span>
              <div className="min-w-0 space-y-1">
                <h2 className="font-display text-xs font-bold uppercase tracking-[0.18em] text-pv-text sm:tracking-[0.2em]">
                  Settlement receipt
                </h2>
                <p className="text-[10px] leading-relaxed text-pv-muted sm:text-[11px]">
                  Resolved by the Mimir oracle agent after committing the ER state to the base layer.
                </p>
              </div>
            </div>

            <div className={`mb-5 inline-flex items-center gap-2 rounded-full border px-3 py-1 font-display text-[10px] font-bold uppercase tracking-[0.18em] ${conf.cls}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
              {conf.label} · {claim.confidence}%
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
              <div className="space-y-4">
                <div className="rounded-xl border border-black/[0.08] bg-pv-bg/40 p-4">
                  <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-pv-emerald/80">
                    ⚖ Verdict
                  </div>
                  <div className="text-lg font-semibold text-pv-text">{SIDE_LABELS[claim.winnerSide]}</div>
                  <p className="mt-2 text-sm leading-relaxed text-pv-muted">
                    {claim.resolutionSummary?.trim() || "No summary recorded."}
                  </p>
                </div>

                <div className="rounded-xl border border-black/[0.08] bg-pv-bg/40 p-4">
                  <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-pv-cyan/80">
                    ⌁ Pool settled
                  </div>
                  <p className="font-mono text-sm font-bold tabular-nums text-pv-text">${usdc(pool)} USDC</p>
                  <p className="mt-2 text-xs leading-relaxed text-pv-muted">
                    Distributed to the winning side across {claim.challengers.length} challenger
                    {claim.challengers.length === 1 ? "" : "s"} and the creator.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-xl border border-black/[0.08] bg-pv-bg/40 p-4">
                  <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-pv-fuch/80">
                    ▤ Evidence
                  </div>
                  <div className="break-words text-sm font-semibold text-pv-text">
                    {(() => {
                      try {
                        return new URL(resolutionHref).hostname.replace(/^www\./i, "");
                      } catch {
                        return claim.resolutionUrl || "unknown source";
                      }
                    })()}
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-pv-muted">
                    The oracle cited this source when issuing the verdict.
                  </p>
                  {claim.resolutionUrl && (
                    <a
                      href={resolutionHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex items-center gap-1.5 text-xs text-pv-cyan transition-colors hover:text-pv-text"
                    >
                      ↗ Open source
                    </a>
                  )}
                </div>

                <div className="rounded-xl border border-black/[0.08] bg-pv-bg/40 p-4">
                  <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-pv-gold/80">
                    ⛨ Confidence
                  </div>
                  <div className="flex items-end justify-between gap-3">
                    <div className="font-display text-3xl font-bold tracking-tight text-pv-text">
                      {claim.confidence}
                    </div>
                    <div className="text-right text-[11px] text-pv-muted">/ 100</div>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/[0.08]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-pv-gold via-pv-fuch to-pv-emerald transition-[width] duration-300"
                      style={{ width: `${Math.max(0, Math.min(100, claim.confidence))}%` }}
                      aria-hidden
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : isCancelled ? (
        <div className="card border-black/[0.12] bg-pv-surface p-5 text-center sm:p-6">
          <p className="text-sm text-pv-muted">This claim was cancelled — all stakes were refunded.</p>
        </div>
      ) : expired ? (
        <div className="card border-pv-gold/25 bg-pv-gold/[0.05] p-5 sm:p-6">
          <div className="text-sm font-semibold text-pv-text">Deadline passed</div>
          <p className="mt-1 text-sm text-pv-muted">
            The oracle agent will commit the Ephemeral Rollup state to the base layer and settle this claim
            shortly.
          </p>
        </div>
      ) : (
        // Challenge form
        <div className="card border-black/[0.12] bg-pv-surface">
          <div className="p-5 sm:p-6">
            <div className="mb-1 flex items-center gap-2">
              <h2 className="font-display text-xs font-bold uppercase tracking-[0.18em] text-pv-text sm:tracking-[0.2em]">
                Challenge this claim
              </h2>
            </div>
            <p className="text-[11px] leading-relaxed text-pv-muted">
              Stake on Side B inside the Ephemeral Rollup — zero fees, instant. Your ER betting balance:{" "}
              <b className="font-mono tabular-nums text-pv-text">${usdc(balance.toString())}</b>
            </p>

            {!wallet.connected ? (
              <p className="mt-4 text-sm text-pv-muted">Connect a wallet to challenge.</p>
            ) : (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <div className="flex items-center overflow-hidden rounded-lg border border-black/[0.15] bg-pv-bg/40">
                  <input
                    type="number"
                    min={2}
                    step={0.5}
                    value={stake}
                    onChange={(e) => setStake(e.target.value)}
                    className="w-24 bg-transparent px-3 py-2 font-mono text-sm tabular-nums text-pv-text outline-none"
                  />
                  <span className="px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">
                    USDC
                  </span>
                </div>
                <button
                  onClick={onChallenge}
                  disabled={!!busy || Number(stake) < 2}
                  className="inline-flex items-center justify-center rounded-md bg-pv-text px-5 py-2 font-display text-[10px] font-bold uppercase tracking-[0.18em] text-pv-bg transition-[transform,box-shadow,background-color,color] duration-200 ease-out hover:-translate-y-px hover:bg-pv-fuch hover:text-pv-bg hover:shadow-[0_6px_18px_-4px_rgba(200,71,71,0.4)] active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:bg-pv-text"
                >
                  {busy ? "Working…" : "⚡ Challenge in the ER"}
                </button>
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-pv-muted">min 2</span>
              </div>
            )}

            {busy && (
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-pv-fuch/25 bg-pv-fuch/[0.06] px-3 py-2 text-sm text-pv-fuch">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pv-fuch" />
                {busy}
              </div>
            )}
            {log.length > 0 && (
              <ul className="mt-4 space-y-1.5 rounded-lg border border-black/[0.08] bg-pv-bg/40 p-3 font-mono text-[11px] leading-relaxed text-pv-text/90">
                {log.map((l, i) => (
                  <li key={i} className="break-words">
                    {l}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ── Challengers list ── */}
      {claim.challengers.length > 0 && (
        <div className="card mt-6 border-black/[0.12] bg-pv-surface sm:mt-8">
          <div className="space-y-4 p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 text-[11px] font-bold uppercase tracking-[0.18em] text-pv-emerald/85">
                Challengers
              </div>
              <span className="inline-flex shrink-0 items-center rounded-full border border-pv-fuch/35 bg-pv-fuch/[0.12] px-2.5 py-1 font-display text-[10px] font-bold uppercase tracking-[0.14em] text-pv-fuch">
                {claim.challengers.length}/{maxChallengers} filled
              </span>
            </div>

            <div className="rounded-xl border border-black/[0.1] bg-pv-bg/25 p-2.5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)] sm:p-3.5">
              <ul className="space-y-2 sm:space-y-2.5">
                {claim.challengers.map((c, i) => {
                  const isYou = wallet.publicKey?.toBase58() === c.addr;
                  return (
                    <li key={`${c.addr}-${i}`}>
                      <div className="rounded-lg border border-black/[0.08] bg-gradient-to-br from-pv-fuch/[0.04] via-transparent to-transparent p-2.5 transition-[border-color] duration-200 hover:border-black/[0.14] sm:p-3">
                        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 sm:gap-3">
                          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-pv-fuch/[0.28] bg-pv-fuch/[0.08] font-mono text-[9px] font-bold tabular-nums text-pv-fuch sm:size-8 sm:text-[10px]">
                            #{i + 1}
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                              <span className="break-all font-mono text-[12px] font-semibold leading-tight text-pv-text sm:text-[13px]">
                                {shorten(c.addr)}
                              </span>
                              {isYou && (
                                <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-pv-emerald">
                                  you
                                </span>
                              )}
                              {!c.paid && (
                                <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-pv-gold">
                                  pending
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-[11px] leading-snug text-pv-muted sm:text-[12px]">
                              {claim.counterPosition}
                            </p>
                          </div>
                          <div className="justify-self-end">
                            <div className="flex h-7 min-w-[4.5rem] items-center justify-center rounded-md border border-black/[0.1] bg-pv-bg/55 px-2 font-mono text-[9px] font-bold tabular-nums text-pv-fuch sm:h-8 sm:text-[10px]">
                              ${usdc(c.stake)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
