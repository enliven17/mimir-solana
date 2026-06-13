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
  delegated: boolean;
  challengers: { addr: string; stake: string; paid: boolean }[];
}

const SIDE_LABELS = ["—", "Creator wins", "Challengers win", "Draw — refunded", "Unresolvable — refunded"];

function usdc(units: string | number): string {
  return (Number(units) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });
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
    return <div className="py-16 text-center text-neutral-500">Loading claim…</div>;
  }

  const expired = claim.deadline <= Math.floor(Date.now() / 1000);
  const pool = Number(claim.creatorStake) + Number(claim.totalChallengerStake);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Link href={`/${params.locale}/arena`} className="text-sm text-neutral-500 hover:text-violet-500">
          ← Arena
        </Link>
        <WalletMultiButton />
      </div>

      <div className="rounded-2xl border border-neutral-200/60 bg-white/50 p-6 dark:border-neutral-800 dark:bg-neutral-900/50">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-medium uppercase text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            {claim.category}
          </span>
          {claim.delegated && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 font-semibold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-500" />
              LIVE ON MAGICBLOCK ER
            </span>
          )}
          {claim.resolutionUrl.includes("flashapi.trade") && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              ⚡ Resolves via Flash Trade oracle
            </span>
          )}
        </div>

        <h1 className="mt-3 text-xl font-semibold leading-snug">{claim.question}</h1>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-emerald-300/40 bg-emerald-50/50 p-3 text-sm dark:bg-emerald-900/10">
            <div className="text-xs font-semibold uppercase text-emerald-600">Side A — Creator</div>
            <div className="mt-1">{claim.creatorPosition}</div>
            <div className="mt-2 font-semibold">${usdc(claim.creatorStake)} staked</div>
          </div>
          <div className="rounded-xl border border-rose-300/40 bg-rose-50/50 p-3 text-sm dark:bg-rose-900/10">
            <div className="text-xs font-semibold uppercase text-rose-600">Side B — Challengers</div>
            <div className="mt-1">{claim.counterPosition}</div>
            <div className="mt-2 font-semibold">
              ${usdc(claim.totalChallengerStake)} · {claim.challengers.length} wallet
              {claim.challengers.length === 1 ? "" : "s"}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-4 text-sm text-neutral-500">
          <span>Pool: <b className="text-neutral-800 dark:text-neutral-200">${usdc(pool)}</b></span>
          <span>
            Deadline:{" "}
            <b className="text-neutral-800 dark:text-neutral-200">
              {new Date(claim.deadline * 1000).toLocaleString()}
            </b>
          </span>
          <span>
            Evidence:{" "}
            <a href={claim.resolutionUrl} target="_blank" rel="noreferrer" className="text-violet-500 underline">
              source ↗
            </a>
          </span>
        </div>
      </div>

      {claim.state === 2 ? (
        <div className="rounded-2xl border border-emerald-300/40 bg-emerald-50/40 p-6 dark:bg-emerald-900/10">
          <div className="text-xs font-semibold uppercase text-emerald-600">Settled by the AI oracle</div>
          <div className="mt-1 text-lg font-semibold">{SIDE_LABELS[claim.winnerSide]}</div>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">{claim.resolutionSummary}</p>
          <div className="mt-2 text-xs text-neutral-500">Oracle confidence: {claim.confidence}%</div>
        </div>
      ) : expired ? (
        <div className="rounded-2xl border border-amber-300/40 bg-amber-50/40 p-6 text-sm dark:bg-amber-900/10">
          Deadline passed — the oracle agent will commit the ER state and settle shortly.
        </div>
      ) : (
        <div className="rounded-2xl border border-neutral-200/60 bg-white/50 p-6 dark:border-neutral-800 dark:bg-neutral-900/50">
          <h2 className="font-semibold">Challenge this claim</h2>
          <p className="mt-1 text-sm text-neutral-500">
            Stake on Side B inside the Ephemeral Rollup — zero fees, instant. Your ER betting
            balance: <b>${usdc(balance.toString())}</b>
          </p>
          {!wallet.connected ? (
            <p className="mt-4 text-sm text-neutral-500">Connect a wallet to challenge.</p>
          ) : (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <input
                type="number"
                min={2}
                step={0.5}
                value={stake}
                onChange={(e) => setStake(e.target.value)}
                className="w-28 rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
              />
              <span className="text-sm text-neutral-500">USDC (min 2)</span>
              <button
                onClick={onChallenge}
                disabled={!!busy || Number(stake) < 2}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50"
              >
                {busy ? "Working…" : "⚡ Challenge in the ER"}
              </button>
            </div>
          )}
          {busy && <div className="mt-3 text-sm text-violet-500">{busy}</div>}
          {log.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm text-neutral-600 dark:text-neutral-300">
              {log.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {claim.challengers.length > 0 && (
        <div className="rounded-2xl border border-neutral-200/60 bg-white/50 p-6 dark:border-neutral-800 dark:bg-neutral-900/50">
          <h2 className="font-semibold">Challengers</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {claim.challengers.map((c, i) => (
              <li key={i} className="flex items-center justify-between gap-3">
                <span className="truncate font-mono text-xs text-neutral-500">{c.addr}</span>
                <span className="shrink-0 font-semibold">${usdc(c.stake)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
