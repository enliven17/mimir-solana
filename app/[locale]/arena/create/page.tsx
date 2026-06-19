"use client";

import { useCallback, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Link, useRouter } from "@/i18n/navigation";
import { Clock, Coins, FileEdit, Link2, User, Users, Zap } from "lucide-react";
import {
  createBrowserMimir,
  createClaim,
  delegateClaim,
} from "@/lib/solana/browser-client";

const CATEGORIES = ["crypto", "sports", "politics", "general"] as const;

const DEADLINE_PRESETS = [
  { label: "30 min", minutes: 30 },
  { label: "1 hour", minutes: 60 },
  { label: "4 hours", minutes: 240 },
  { label: "24 hours", minutes: 1440 },
] as const;

const STAKE_PRESETS = [1, 2, 5, 10] as const;

export default function CreateMarketPage() {
  const router = useRouter();
  const wallet = useWallet();
  const mimir = useMemo(
    () => createBrowserMimir(wallet),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wallet.publicKey, wallet.signTransaction]
  );

  const [question, setQuestion] = useState("");
  const [creatorPos, setCreatorPos] = useState("");
  const [opponentPos, setOpponentPos] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("general");
  const [resolutionUrl, setResolutionUrl] = useState("");
  const [deadlineMinutes, setDeadlineMinutes] = useState(60);
  const [stake, setStake] = useState(2);
  const [customStake, setCustomStake] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const effectiveStake = customStake.trim() ? Math.max(1, Math.floor(Number(customStake))) : stake;

  const onSubmit = useCallback(async () => {
    if (!mimir) return;
    setError(null);
    if (!question.trim() || !creatorPos.trim() || !opponentPos.trim()) {
      setError("Question and both positions are required");
      return;
    }
    const stakeUnits = BigInt(Math.round(effectiveStake * 1e6));
    if (stakeUnits < 1_000_000n) { setError("Minimum stake is 1 USDC"); return; }
    const deadline = Math.floor(Date.now() / 1000) + deadlineMinutes * 60;
    try {
      setBusy("Creating claim on Solana…");
      const { claimId } = await createClaim(mimir, {
        question: question.trim(),
        creatorPosition: creatorPos.trim(),
        counterPosition: opponentPos.trim(),
        resolutionUrl: resolutionUrl.trim(),
        category,
        stakeAmount: stakeUnits,
        deadline,
        maxChallengers: 16,
      });
      setBusy("Delegating to MagicBlock ER…");
      await delegateClaim(mimir, claimId);
      router.push(`/arena/${claimId}`);
    } catch (err: any) {
      setError(err?.message ?? "Transaction failed");
      setBusy(null);
    }
  }, [mimir, question, creatorPos, opponentPos, resolutionUrl, category, effectiveStake, deadlineMinutes, router]);

  const sectionCls = "space-y-4 rounded-2xl border border-black/[0.08] bg-pv-surface/60 p-6 sm:p-8";
  const sectionHeadingCls = "flex items-center gap-2.5 font-display text-xs font-bold uppercase tracking-[0.18em] text-pv-text";
  const sectionIconCls = "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pv-emerald/10 text-pv-emerald";
  const presetActiveCls = "border-pv-emerald bg-pv-emerald/[0.12] text-pv-emerald shadow-[0_0_16px_-8px_rgba(52,211,153,0.3)]";
  const presetIdleCls = "border border-black/[0.12] bg-pv-surface text-pv-muted hover:border-pv-emerald/35 hover:text-pv-emerald";
  const presetBaseCls = "rounded-lg border px-3 py-2.5 font-display text-[11px] font-bold transition-[border-color,background-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-emerald/35";

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-20 pt-4 sm:px-6">
      {/* Top bar */}
      <div className="mb-8 flex items-center justify-between gap-4">
        <Link
          href="/arena"
          className="inline-flex items-center gap-2 rounded-lg border border-transparent px-2 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-pv-muted transition-[color,border-color,background-color] hover:border-black/[0.1] hover:bg-black/[0.04] hover:text-pv-text"
        >
          ← Arena
        </Link>
        <WalletMultiButton />
      </div>

      <div className="mb-8">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-pv-emerald">
          PUBLISH CHALLENGE
        </p>
        <h1 className="mt-2 font-display text-2xl font-bold uppercase tracking-tight text-pv-text sm:text-3xl">
          CREATE A MARKET
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-pv-muted">
          Stake USDC on your prediction. Challengers take the opposite side.
          The Mimir oracle settles at the deadline.
        </p>
      </div>

      {!wallet.connected ? (
        <div className="rounded-2xl border border-black/[0.08] bg-pv-surface/60 p-8 text-center">
          <p className="mb-4 text-sm text-pv-muted">Connect your wallet to publish a challenge</p>
          <WalletMultiButton />
        </div>
      ) : (
        <div className="space-y-4">

          {/* Question */}
          <div className={sectionCls}>
            <h2 className={sectionHeadingCls}>
              <span className={sectionIconCls} aria-hidden><FileEdit size={16} strokeWidth={2} /></span>
              Challenge
            </h2>
            <div className="relative">
              <div className="absolute inset-0 rounded-2xl pointer-events-none bg-gradient-to-br from-pv-cyan/[0.03] via-transparent to-pv-fuch/[0.03]" />
              <textarea
                rows={4}
                placeholder="Will Bitcoin trade above $70,000 at the deadline?"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                className="min-h-[120px] w-full resize-none rounded-2xl border border-black/[0.12] bg-pv-bg/40 p-5 font-display text-lg leading-snug tracking-tight text-pv-text outline-none transition-all placeholder:text-pv-muted/30 focus:border-pv-emerald/50 focus:ring-1 focus:ring-pv-emerald/30 sm:text-xl"
              />
            </div>

            {/* Side A / Side B */}
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-0">
              <div className="relative flex flex-col gap-3 md:pr-4 md:border-r md:border-black/[0.06]">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-pv-cyan/10 text-pv-cyan" aria-hidden>
                    <User size={14} strokeWidth={2} />
                  </span>
                  <span className="font-display text-[10px] font-bold uppercase tracking-[0.18em] text-pv-cyan">I BET</span>
                </div>
                <input
                  type="text"
                  placeholder="Yes — BTC will be above $70k"
                  value={creatorPos}
                  onChange={(e) => setCreatorPos(e.target.value)}
                  className="w-full rounded-xl border border-pv-cyan/[0.15] bg-pv-bg/90 px-4 py-3 text-sm text-pv-text outline-none transition-all placeholder:text-pv-muted/55 focus:border-pv-cyan/40 focus:ring-1 focus:ring-pv-cyan/20"
                />
              </div>
              <div className="relative flex flex-col gap-3 md:pl-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-pv-fuch/10 text-pv-fuch" aria-hidden>
                    <Users size={14} strokeWidth={2} />
                  </span>
                  <span className="font-display text-[10px] font-bold uppercase tracking-[0.18em] text-pv-fuch">CHALLENGERS BET</span>
                </div>
                <input
                  type="text"
                  placeholder="No — BTC will not reach $70k"
                  value={opponentPos}
                  onChange={(e) => setOpponentPos(e.target.value)}
                  className="w-full rounded-xl border border-pv-fuch/[0.15] bg-pv-bg/90 px-4 py-3 text-sm text-pv-text outline-none transition-all placeholder:text-pv-muted/55 focus:border-pv-fuch/40 focus:ring-1 focus:ring-pv-fuch/20"
                />
              </div>
            </div>
          </div>

          {/* Stake */}
          <div className={sectionCls}>
            <h2 className={sectionHeadingCls}>
              <span className={sectionIconCls} aria-hidden><Coins size={16} strokeWidth={2} /></span>
              Your Stake
            </h2>
            <div className="flex flex-wrap gap-2">
              {STAKE_PRESETS.map((amount) => {
                const active = !customStake.trim() && stake === amount;
                return (
                  <button
                    key={amount}
                    type="button"
                    onClick={() => { setStake(amount); setCustomStake(""); }}
                    aria-pressed={active}
                    className={`${presetBaseCls} min-w-[5rem] ${active ? presetActiveCls : presetIdleCls}`}
                  >
                    {amount} USDC
                  </button>
                );
              })}
              <div className={`flex items-center rounded-lg border px-3 py-2.5 transition-[border-color,background-color,color] min-w-[6rem] ${customStake.trim() ? presetActiveCls : presetIdleCls}`}>
                <input
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  placeholder="Custom"
                  value={customStake}
                  onChange={(e) => setCustomStake(e.target.value)}
                  className="w-full bg-transparent font-display text-[11px] font-bold text-inherit outline-none placeholder:text-pv-muted/50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                {customStake.trim() && <span className="ml-1 shrink-0 font-display text-[10px] font-bold text-inherit">USDC</span>}
              </div>
            </div>
            <p className="text-[11px] text-pv-muted">Min 1 USDC · you stake on the YES side, challengers stake on NO</p>
          </div>

          {/* Deadline */}
          <div className={sectionCls}>
            <h2 className={sectionHeadingCls}>
              <span className={sectionIconCls} aria-hidden><Clock size={16} strokeWidth={2} /></span>
              Deadline
            </h2>
            <div className="flex flex-wrap gap-2">
              {DEADLINE_PRESETS.map((p) => {
                const active = deadlineMinutes === p.minutes;
                return (
                  <button
                    key={p.minutes}
                    type="button"
                    onClick={() => setDeadlineMinutes(p.minutes)}
                    aria-pressed={active}
                    className={`${presetBaseCls} min-w-[5rem] ${active ? presetActiveCls : presetIdleCls}`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Resolution source */}
          <div className={sectionCls}>
            <h2 className={sectionHeadingCls}>
              <span className={sectionIconCls} aria-hidden><Link2 size={16} strokeWidth={2} /></span>
              Resolution Source
            </h2>
            <input
              type="url"
              placeholder="https://flashapi.trade/prices/BTC  (leave blank for web search)"
              value={resolutionUrl}
              onChange={(e) => setResolutionUrl(e.target.value)}
              spellCheck={false}
              className="w-full rounded-xl border border-black/[0.12] bg-pv-bg/90 px-4 py-3 font-mono text-xs text-pv-text outline-none transition-all placeholder:text-pv-muted/40 focus:border-pv-emerald/50 focus:ring-1 focus:ring-pv-emerald/20"
            />
            <p className="text-[11px] leading-relaxed text-pv-muted">
              The oracle fetches this URL at the deadline to verify the outcome. Leave blank to use web search.
            </p>

            {/* Category */}
            <div className="pt-2">
              <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-pv-muted">Category</p>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((c) => {
                  const active = category === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCategory(c)}
                      aria-pressed={active}
                      className={`${presetBaseCls} capitalize ${active ? presetActiveCls : presetIdleCls}`}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-xl border border-red-400/30 bg-red-500/[0.08] px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void onSubmit()}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl border border-pv-emerald/40 bg-pv-emerald/[0.12] font-display text-sm font-bold uppercase tracking-[0.18em] text-pv-emerald transition-colors hover:border-pv-emerald/60 hover:bg-pv-emerald/[0.2] disabled:cursor-wait disabled:opacity-60"
          >
            {busy ?? (
              <>
                <span>PUBLISH · {effectiveStake} USDC</span>
                <Zap size={16} aria-hidden />
              </>
            )}
          </button>

          <p className="text-center text-[11px] text-pv-muted">
            Two transactions: create on Solana devnet, then delegate to MagicBlock ER.
            Need test USDC?{" "}
            <a
              href="https://faucet.circle.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-pv-cyan underline underline-offset-2"
            >
              faucet.circle.com
            </a>{" "}
            → USDC · Solana Devnet.
          </p>
        </div>
      )}
    </div>
  );
}
