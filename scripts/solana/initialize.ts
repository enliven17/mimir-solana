/**
 * One-time program initialization: creates the Config PDA and the USDC
 * vault bound to the configured mint (Circle devnet USDC by default),
 * with the admin keypair as both admin and oracle.
 *
 * Run: npx tsx --env-file-if-exists=.env.local scripts/solana/initialize.ts
 */
import { loadAgentKeypair } from "../../lib/solana/keypair";
import { MimirSolanaClient } from "../../lib/solana/client";
import { USDC_MINT, SOLANA_RPC } from "../../lib/solana/config";

async function main() {
  const admin = loadAgentKeypair();
  const client = new MimirSolanaClient(admin);

  console.log("Mimir initialize");
  console.log("  program :", client.base.programId.toBase58());
  console.log("  rpc     :", SOLANA_RPC);
  console.log("  mint    :", USDC_MINT.toBase58());
  console.log("  admin   :", admin.publicKey.toBase58(), "(also oracle)");

  const existing = await client.getConfig();
  if (existing) {
    console.log(
      `\nConfig already exists — mint ${existing.usdcMint.toBase58()}, ` +
        `oracle ${existing.oracle.toBase58()}, claims ${existing.claimCount}. Nothing to do.`
    );
    return;
  }

  const sig = await client.initialize(admin.publicKey);
  console.log(`\n✓ Initialized — https://explorer.solana.com/tx/${sig}?cluster=devnet`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
