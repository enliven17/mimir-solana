/**
 * Mimir on Solana — full economic cycle demo (~2 minutes):
 *
 *   1. (once) create a 6dp test-USDC mint + program config
 *   2. creator opens a claim on the BASE layer (USDC stake → vault)
 *   3. claim PDA + challenger balance PDA are DELEGATED to the MagicBlock ER
 *   4. challenger stakes inside the ER  ← zero-fee, ~30ms, the core beat
 *   5. deadline passes → oracle commits + undelegates the claim
 *   6. oracle resolves on the base layer (verdict + evidence hash)
 *   7. winner pulls the payout from the vault
 *
 * Run: npx tsx --env-file-if-exists=.env.local scripts/solana/demo-full-cycle.ts
 */
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  getAccount,
  transfer as splTransfer,
} from "@solana/spl-token";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { MimirSolanaClient } from "../../lib/solana/client";
import {
  SOLANA_RPC,
  USDC_MINT,
  toUsdcUnits,
  fromUsdcUnits,
  SIDE_CHALLENGERS,
  ST_RESOLVED,
} from "../../lib/solana/config";

const KEYPAIR_PATH =
  process.env.SOLANA_KEYPAIR ||
  join(homedir(), ".config", "solana", "talos-deploy.json");

function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(path, "utf8")))
  );
}

function log(step: string, msg: string) {
  console.log(`\n[${step}] ${msg}`);
}

function explorer(sig: string, er = false): string {
  return er
    ? `ER tx: ${sig}`
    : `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

async function main() {
  const connection = new Connection(SOLANA_RPC, "confirmed");
  const admin = loadKeypair(KEYPAIR_PATH); // admin = oracle = creator (demo)
  const challenger = Keypair.generate();

  console.log("Mimir × Solana × MagicBlock ER — full cycle demo");
  console.log("  base RPC :", SOLANA_RPC);
  console.log("  admin    :", admin.publicKey.toBase58());
  console.log("  challenger:", challenger.publicKey.toBase58());

  // ── 0. Fund challenger with a little SOL for fees ──────────────────────
  log("0", "funding challenger with 0.05 SOL for base-layer fees...");
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: challenger.publicKey,
        lamports: 0.05 * LAMPORTS_PER_SOL,
      })
    ),
    [admin]
  );

  const oracle = new MimirSolanaClient(admin);
  const challengerClient = new MimirSolanaClient(challenger);

  // ── 1. Config (idempotent) — vault is bound to Circle devnet USDC ──────
  const mint = USDC_MINT;
  const existingConfig = await oracle.getConfig();
  if (!existingConfig) {
    log("1", "initializing program config (oracle = admin)...");
    const sig = await oracle.initialize(admin.publicKey);
    console.log("  " + explorer(sig));
  } else {
    log("1", `config exists — claims so far: ${existingConfig.claimCount}`);
  }

  // ── 2. USDC: the admin wallet pays for the demo ────────────────────────
  // Fund it first: https://faucet.circle.com → Solana Devnet → admin address
  log("2", "checking admin USDC and funding the demo challenger...");
  const creatorAta = await getOrCreateAssociatedTokenAccount(
    connection,
    admin,
    mint,
    admin.publicKey
  );
  const needed = toUsdcUnits(15); // 5 creator stake + 10 challenger budget
  if (BigInt(creatorAta.amount.toString()) < needed) {
    console.error(
      `  Admin has ${fromUsdcUnits(BigInt(creatorAta.amount.toString()))} USDC, demo needs 15.\n` +
        `  Fund it: https://faucet.circle.com → Solana Devnet → ${admin.publicKey.toBase58()}`
    );
    return;
  }
  const challengerAta = await getOrCreateAssociatedTokenAccount(
    connection,
    admin,
    mint,
    challenger.publicKey
  );
  await splTransfer(
    connection,
    admin,
    creatorAta.address,
    challengerAta.address,
    admin,
    Number(toUsdcUnits(10))
  );
  console.log("  challenger funded with 10 USDC from the admin wallet");

  // ── 3. Creator opens a claim (base layer) ──────────────────────────────
  const deadline = Math.floor(Date.now() / 1000) + 150; // 2.5 min
  log("3", "creating claim on base layer (5 USDC creator stake)...");
  const { txSig, claimId } = await oracle.createClaim({
    question: "Will BTC trade above $100,000 right now per Flash Trade oracle?",
    creatorPosition: "Yes — BTC is above $100k",
    counterPosition: "No — BTC is at or below $100k",
    resolutionUrl: "https://flashapi.trade/prices/BTC",
    category: "crypto",
    stakeAmount: toUsdcUnits(5),
    deadline,
    maxChallengers: 8,
  });
  console.log("  claim #" + claimId, explorer(txSig));

  // ── 4. Delegate claim + challenger balance into the ER ─────────────────
  log("4", "depositing challenger USDC into escrow + delegating to ER...");
  const dep = await challengerClient.deposit(toUsdcUnits(8));
  console.log("  deposit 8 USDC:", explorer(dep));
  const delBal = await challengerClient.delegateBalance();
  console.log("  balance PDA → ER:", explorer(delBal));
  const delClaim = await oracle.delegateClaim(claimId);
  console.log("  claim PDA   → ER:", explorer(delClaim));
  await new Promise((r) => setTimeout(r, 3000)); // let delegation settle

  // ── 5. Challenge inside the Ephemeral Rollup ───────────────────────────
  log("5", "challenging inside the ER (zero fee, real-time)...");
  const t0 = Date.now();
  const erSig = await challengerClient.challengeClaimER(claimId, toUsdcUnits(5));
  const dt = Date.now() - t0;
  console.log(`  ER challenge landed in ${dt}ms — ${explorer(erSig, true)}`);
  const live = await oracle.getClaim(claimId);
  console.log(
    `  live ER state: ${live?.challengers.length} challenger(s), pool = ${fromUsdcUnits(
      (live?.creatorStake ?? 0n) + (live?.totalChallengerStake ?? 0n)
    )} USDC`
  );

  // ── 6. Wait for the deadline ───────────────────────────────────────────
  const waitMs = deadline * 1000 - Date.now() + 5000;
  log("6", `waiting ${Math.ceil(waitMs / 1000)}s for the deadline...`);
  await new Promise((r) => setTimeout(r, Math.max(waitMs, 0)));

  // ── 7. Oracle: commit + undelegate, then resolve on base ──────────────
  log("7", "oracle commits + undelegates the claim from the ER...");
  const undel = await oracle.undelegateClaim(claimId);
  console.log("  " + explorer(undel, true));
  // wait for the commitment to land on base layer
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    if (!(await oracle.isDelegated(claimId))) break;
  }
  console.log("  claim is back on the base layer");

  // Evidence: fetch the resolution URL like the real oracle agent does
  let evidence = "";
  try {
    const res = await fetch("https://flashapi.trade/prices");
    evidence = await res.text();
  } catch {
    evidence = "demo-evidence-unavailable";
  }
  const evidenceHash = createHash("sha256").update(evidence).digest();

  log("7b", "oracle resolves: CHALLENGERS_WIN (demo verdict)...");
  const resSig = await oracle.resolveClaim(
    claimId,
    SIDE_CHALLENGERS,
    "Demo verdict: challenger side wins. Evidence fetched from Flash Trade price API.",
    92,
    evidenceHash
  );
  console.log("  " + explorer(resSig));

  // ── 8. Payout ──────────────────────────────────────────────────────────
  log("8", "paying out the winning challenger from the vault...");
  const pay = await oracle.payoutChallenger(claimId, 0, challenger.publicKey);
  console.log("  " + explorer(pay));

  const finalAta = await getAccount(connection, challengerAta.address);
  const finalClaim = await oracle.getClaim(claimId);
  console.log("\n══════════ RESULT ══════════");
  console.log(
    "  claim state:",
    finalClaim?.state === ST_RESOLVED ? "RESOLVED" : finalClaim?.state
  );
  console.log("  winner side:", finalClaim?.winnerSide, "(2 = challengers)");
  console.log("  confidence :", finalClaim?.confidence + "%");
  console.log(
    "  challenger wallet USDC:",
    fromUsdcUnits(BigInt(finalAta.amount.toString())),
    "(2 left after 8 deposit, +10 payout = 12 expected)"
  );
  console.log("  evidence hash:", Buffer.from(finalClaim!.evidenceHash).toString("hex").slice(0, 16) + "…");
  console.log("\nDone. Mimir cycle: base → ER (real-time challenge) → base (settlement). ✅");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
