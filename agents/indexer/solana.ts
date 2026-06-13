/**
 * Mimir Indexer — mirrors on-chain claim state into the Neon read-index.
 *
 * Every cycle it walks all claims (reading from whichever layer owns each —
 * the Ephemeral Rollup for delegated claims, the base layer otherwise) and
 * upserts a denormalized snapshot into Postgres. The arena feed then serves
 * from one SQL query instead of fanning out RPC reads on every poll.
 *
 * No-ops cleanly if DATABASE_URL is unset (the feed falls back to chain reads).
 *
 * Run: npx tsx --env-file-if-exists=.env.local agents/indexer/solana.ts
 * Env: INDEXER_POLL_INTERVAL_MS (default 15000)
 */
import { loadAgentKeypair } from "../../lib/solana/keypair";
import { MimirSolanaClient } from "../../lib/solana/client";
import { isIndexEnabled, upsertClaim } from "../../lib/server/solana-index";

const POLL_INTERVAL_MS = Number(process.env.INDEXER_POLL_INTERVAL_MS ?? "15000");

async function cycle(client: MimirSolanaClient): Promise<void> {
  const cfg = await client.getConfig();
  if (!cfg) {
    console.warn("[indexer] config not found — is the program initialized?");
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  let written = 0;
  for (let id = 1n; id <= cfg.claimCount; id++) {
    const [claim, delegated] = await Promise.all([
      client.getClaim(id),
      client.isDelegated(id),
    ]);
    if (!claim) continue;
    await upsertClaim({
      id: Number(claim.id),
      creator: claim.creator.toBase58(),
      question: claim.question,
      creator_position: claim.creatorPosition,
      counter_position: claim.counterPosition,
      resolution_url: claim.resolutionUrl,
      category: claim.category,
      creator_stake: claim.creatorStake.toString(),
      total_challenger_stake: claim.totalChallengerStake.toString(),
      deadline: claim.deadline,
      state: claim.state,
      winner_side: claim.winnerSide,
      resolution_summary: claim.resolutionSummary,
      confidence: claim.confidence,
      created_at: claim.createdAt,
      max_challengers: claim.maxChallengers,
      delegated,
      challengers: claim.challengers.map((c) => ({
        addr: c.addr.toBase58(),
        stake: c.stake.toString(),
        paid: c.paid,
      })),
      updated_at: now,
    });
    written++;
  }
  console.log(`[indexer] ${new Date().toISOString()} — synced ${written}/${cfg.claimCount} claims`);
}

async function main(): Promise<void> {
  if (!isIndexEnabled()) {
    console.log("[indexer] DATABASE_URL not set — nothing to index, exiting cleanly.");
    return;
  }
  const client = new MimirSolanaClient(loadAgentKeypair());

  console.log("═══════════════════════════════════════════════");
  console.log("  Mimir Indexer — Solana → Neon read-index");
  console.log(`  Program : ${client.base.programId.toBase58()}`);
  console.log(`  Cadence : every ${POLL_INTERVAL_MS / 1000}s`);
  console.log("═══════════════════════════════════════════════\n");

  const safe = async () => {
    try {
      await cycle(client);
    } catch (err) {
      console.error("[indexer] cycle failed, retrying next interval:", err);
    }
  };
  await safe();
  setInterval(safe, POLL_INTERVAL_MS);
}

process.on("unhandledRejection", (err) => {
  console.warn("[indexer] unhandled rejection (non-fatal):", String(err).slice(0, 120));
});

main().catch((err) => {
  console.error("[indexer] fatal:", err);
  process.exit(1);
});
