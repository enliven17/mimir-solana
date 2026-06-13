/**
 * Mimir Market-Creator Agent — Solana × Flash Trade edition
 *
 * Every cycle it reads live Flash Trade oracle prices (BTC/ETH/SOL), drafts
 * short-horizon price claims around the spot price, creates the best ones
 * on-chain with its own USDC stake, and immediately delegates each claim to
 * the MagicBlock Ephemeral Rollup so challenges are real-time and fee-less.
 *
 * Resolution source IS Flash Trade: the claim's resolutionUrl points at
 * https://flashapi.trade/prices/<SYMBOL>, which the oracle agent fetches as
 * settlement evidence.
 *
 * Run: npx tsx --env-file-if-exists=.env.local agents/market-creator/solana.ts
 * Env: SOLANA_KEYPAIR, SOLANA_USDC_MINT, NEXT_PUBLIC_MIMIR_PROGRAM_ID
 *      CREATOR_INTERVAL_MS   (default 3_600_000 = 1h)
 *      CREATOR_MAX_PER_RUN   (default 3)
 *      CREATOR_STAKE_USDC    (default 3)
 *      CREATOR_HORIZON_MIN   (claim deadline horizon in minutes, default 30)
 */
import { loadCreatorKeypair } from "../../lib/solana/keypair";
import { MimirSolanaClient } from "../../lib/solana/client";
import { toUsdcUnits, fromUsdcUnits } from "../../lib/solana/config";
import {
  FLASH_CLAIM_SYMBOLS,
  flashResolutionUrl,
  getFlashPrice,
} from "../../lib/solana/flashtrade";

const INTERVAL_MS = Number(process.env.CREATOR_INTERVAL_MS ?? "3600000");
const MAX_PER_RUN = Number(process.env.CREATOR_MAX_PER_RUN ?? "3");
const STAKE_USDC = Number(process.env.CREATOR_STAKE_USDC ?? "3");
const HORIZON_MIN = Number(process.env.CREATOR_HORIZON_MIN ?? "30");

const SYMBOL_NAMES: Record<string, string> = {
  BTC: "Bitcoin",
  ETH: "Ethereum",
  SOL: "Solana",
};

interface Draft {
  symbol: string;
  question: string;
  creatorPosition: string;
  counterPosition: string;
  threshold: number;
  direction: "above" | "below";
}

/**
 * Draft one claim per symbol: "will <SYM> trade above/below <spot ± 0.3%>
 * at the deadline per Flash Trade oracle?". Tight thresholds keep markets
 * genuinely uncertain, which is what makes them challenge-ready.
 */
async function draftClaims(): Promise<Draft[]> {
  const out: Draft[] = [];
  for (const symbol of FLASH_CLAIM_SYMBOLS) {
    try {
      const px = await getFlashPrice(symbol);
      const direction = Math.random() < 0.5 ? "above" : "below";
      const skew = direction === "above" ? 1.003 : 0.997;
      const threshold = round2(px.priceUi * skew);
      const name = SYMBOL_NAMES[symbol] ?? symbol;
      out.push({
        symbol,
        direction,
        threshold,
        question: `Will ${name} (${symbol}) trade ${direction} $${fmt(threshold)} at the deadline, per the Flash Trade oracle price?`,
        creatorPosition: `Yes — ${symbol} will be ${direction} $${fmt(threshold)}`,
        counterPosition: `No — ${symbol} will not be ${direction} $${fmt(threshold)}`,
      });
      console.log(
        `[draft] ${symbol} spot $${fmt(px.priceUi)} → claim: ${direction} $${fmt(threshold)}`
      );
    } catch (err: any) {
      console.warn(`[draft] ${symbol} price fetch failed:`, err?.message ?? err);
    }
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

async function runCycle(client: MimirSolanaClient): Promise<void> {
  console.log(`\n[creator] ── Cycle at ${new Date().toISOString()}`);
  const drafts = (await draftClaims()).slice(0, MAX_PER_RUN);
  if (!drafts.length) {
    console.log("[creator] No drafts this cycle.");
    return;
  }

  const deadline = Math.floor(Date.now() / 1000) + HORIZON_MIN * 60;
  for (const d of drafts) {
    try {
      const { txSig, claimId } = await client.createClaim({
        question: d.question,
        creatorPosition: d.creatorPosition,
        counterPosition: d.counterPosition,
        resolutionUrl: flashResolutionUrl(d.symbol),
        category: "crypto",
        stakeAmount: toUsdcUnits(STAKE_USDC),
        deadline,
        maxChallengers: 16,
      });
      console.log(
        `[creator] ✓ Claim #${claimId} (${d.symbol} ${d.direction} $${fmt(d.threshold)}) — ` +
          `https://explorer.solana.com/tx/${txSig}?cluster=devnet`
      );
      // Hand the market to the Ephemeral Rollup right away: from here on,
      // every challenge is a zero-fee, ~30ms ER transaction.
      const delSig = await client.delegateClaim(claimId);
      console.log(`[creator]   → delegated to MagicBlock ER (${delSig.slice(0, 16)}…)`);
    } catch (err: any) {
      console.error(`[creator] Failed to create ${d.symbol} claim:`, err?.message ?? err);
    }
  }
}

async function main(): Promise<void> {
  const keypair = loadCreatorKeypair();
  const client = new MimirSolanaClient(keypair);
  const cfg = await client.getConfig();

  console.log("═══════════════════════════════════════════════");
  console.log("  Mimir Market-Creator — Solana × Flash Trade");
  console.log(`  Program  : ${client.base.programId.toBase58()}`);
  console.log(`  Creator  : ${client.publicKey.toBase58()}`);
  console.log(`  Claims   : ${cfg?.claimCount ?? "config missing!"}`);
  console.log(`  Cadence  : every ${INTERVAL_MS / 60000} min, max ${MAX_PER_RUN}/run`);
  console.log(`  Stake    : ${STAKE_USDC} USDC · horizon ${HORIZON_MIN} min`);
  console.log("═══════════════════════════════════════════════\n");

  const safeCycle = async () => {
    try {
      await runCycle(client);
    } catch (err) {
      console.error("[creator] Cycle failed, will retry next interval:", err);
    }
  };
  await safeCycle();
  setInterval(safeCycle, INTERVAL_MS);
}

main().catch((err) => {
  console.error("[creator] Fatal:", err);
  process.exit(1);
});
