"use client";

import { useCallback, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Link } from "@/i18n/navigation";
import {
  createBrowserMimir,
  createClaim,
  delegateClaim,
} from "@/lib/solana/browser-client";

const CATEGORIES = ["crypto", "sports", "politics", "general"] as const;
const HORIZONS = [
  { label: "30 minutes", value: 30 },
  { label: "1 hour", value: 60 },
  { label: "4 hours", value: 240 },
  { label: "24 hours", value: 1440 },
] as const;

const inputCls =
  "w-full rounded border border-black/[0.1] bg-pv-bg px-3 py-2.5 font-body text-sm text-pv-text placeholder:text-pv-muted/60 focus:border-pv-emerald/40 focus:outline-none focus:ring-1 focus:ring-pv-emerald/20";
const labelCls = "mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-pv-muted";

export default function CreateMarketPage() {
  const { locale } = useParams<{ locale: string }>();
  const router = useRouter();
  const wallet = useWallet();
  const mimir = useMemo(
    () => createBrowserMimir(wallet),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wallet.publicKey, wallet.signTransaction]
  );

  const [form, setForm] = useState({
    question: "",
    creatorPosition: "",
    counterPosition: "",
    category: "general" as (typeof CATEGORIES)[number],
    resolutionUrl: "",
    horizonMin: 60,
    stakeUsdc: "2",
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const onSubmit = useCallback(async () => {
    if (!mimir) return;
    setError(null);
    const stakeUnits = BigInt(Math.round(Number(form.stakeUsdc) * 1e6));
    if (stakeUnits < 1_000_000n) { setError("Minimum stake is 1 USDC"); return; }
    if (!form.question.trim() || !form.creatorPosition.trim() || !form.counterPosition.trim()) {
      setError("Question and both positions are required");
      return;
    }
    const deadline = Math.floor(Date.now() / 1000) + form.horizonMin * 60;
    try {
      setBusy("Creating claim on Solana…");
      const { claimId } = await createClaim(mimir, {
        question: form.question.trim(),
        creatorPosition: form.creatorPosition.trim(),
        counterPosition: form.counterPosition.trim(),
        resolutionUrl: form.resolutionUrl.trim(),
        category: form.category,
        stakeAmount: stakeUnits,
        deadline,
        maxChallengers: 16,
      });
      setBusy("Delegating to MagicBlock ER for real-time challenges…");
      await delegateClaim(mimir, claimId);
      router.push(`/${locale}/arena/${claimId}`);
    } catch (err: any) {
      setError(err?.message ?? "Transaction failed");
      setBusy(null);
    }
  }, [mimir, form, locale, router]);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-16 pt-4 sm:px-6">
      {/* Top bar */}
      <div className="mb-8 flex items-center justify-between gap-4">
        <Link
          href={`/${locale}/arena`}
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
        <div className="space-y-5 rounded-2xl border border-black/[0.08] bg-pv-surface/60 p-6 sm:p-8">
          {/* Question */}
          <div>
            <label className={labelCls} htmlFor="question">
              QUESTION <span className="text-pv-emerald">*</span>
            </label>
            <textarea
              id="question"
              rows={3}
              placeholder="Will Bitcoin trade above $70,000 at the deadline?"
              value={form.question}
              onChange={set("question")}
              className={inputCls}
            />
          </div>

          {/* Positions */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="yes-pos">
                YES POSITION <span className="text-pv-emerald">*</span>
              </label>
              <input
                id="yes-pos"
                type="text"
                placeholder="Yes — BTC will be above $70k"
                value={form.creatorPosition}
                onChange={set("creatorPosition")}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="no-pos">
                NO POSITION <span className="text-pv-emerald">*</span>
              </label>
              <input
                id="no-pos"
                type="text"
                placeholder="No — BTC will not reach $70k"
                value={form.counterPosition}
                onChange={set("counterPosition")}
                className={inputCls}
              />
            </div>
          </div>

          {/* Category + Deadline */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="category">CATEGORY</label>
              <select
                id="category"
                value={form.category}
                onChange={set("category")}
                className={inputCls}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="horizon">DEADLINE</label>
              <select
                id="horizon"
                value={form.horizonMin}
                onChange={(e) => setForm((f) => ({ ...f, horizonMin: Number(e.target.value) }))}
                className={inputCls}
              >
                {HORIZONS.map((h) => (
                  <option key={h.value} value={h.value}>{h.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Resolution URL */}
          <div>
            <label className={labelCls} htmlFor="resolution-url">
              RESOLUTION SOURCE URL
            </label>
            <input
              id="resolution-url"
              type="url"
              placeholder="https://flashapi.trade/prices/BTC  (leave blank for web search)"
              value={form.resolutionUrl}
              onChange={set("resolutionUrl")}
              className={inputCls}
            />
            <p className="mt-1.5 text-[11px] text-pv-muted">
              The oracle fetches this URL (or searches the web) to verify the outcome.
            </p>
          </div>

          {/* Stake */}
          <div>
            <label className={labelCls} htmlFor="stake">YOUR STAKE (USDC)</label>
            <input
              id="stake"
              type="number"
              min="1"
              step="0.5"
              placeholder="2.00"
              value={form.stakeUsdc}
              onChange={set("stakeUsdc")}
              className={`${inputCls} max-w-[12rem]`}
            />
            <p className="mt-1.5 text-[11px] text-pv-muted">
              Minimum 1 USDC. You stake on the YES side; challengers stake on NO.
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-lg border border-red-400/30 bg-red-500/[0.08] px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void onSubmit()}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-pv-emerald/40 bg-pv-emerald/[0.12] font-display text-sm font-bold uppercase tracking-[0.18em] text-pv-emerald transition-colors hover:border-pv-emerald/60 hover:bg-pv-emerald/[0.2] disabled:cursor-wait disabled:opacity-60"
          >
            {busy ?? "PUBLISH CHALLENGE"}
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
            → select USDC · Solana Devnet.
          </p>
        </div>
      )}
    </div>
  );
}
