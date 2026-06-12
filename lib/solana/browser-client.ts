"use client";

/**
 * Browser-side Mimir program access driven by a wallet-adapter wallet.
 * Mirrors MimirSolanaClient (lib/solana/client.ts) but signs through the
 * connected wallet instead of a Keypair.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  SOLANA_RPC,
  MAGICBLOCK_ER_RPC,
  ER_VALIDATOR,
  USDC_MINT,
  balancePda,
  claimPda,
} from "./config";
import idl from "./idl/mimir.json";

export interface BrowserMimir {
  base: Program;
  er: Program;
  owner: PublicKey;
}

export function createBrowserMimir(wallet: WalletContextState): BrowserMimir | null {
  if (!wallet.publicKey || !wallet.signTransaction) return null;
  const anchorWallet = {
    publicKey: wallet.publicKey,
    signTransaction: wallet.signTransaction as any,
    signAllTransactions: (wallet.signAllTransactions ?? (async (txs: any[]) => {
      const out = [] as any[];
      for (const tx of txs) out.push(await wallet.signTransaction!(tx));
      return out;
    })) as any,
  };
  const baseProvider = new AnchorProvider(
    new Connection(SOLANA_RPC, "confirmed"),
    anchorWallet as any,
    { commitment: "confirmed" }
  );
  const erProvider = new AnchorProvider(
    new Connection(MAGICBLOCK_ER_RPC, "confirmed"),
    anchorWallet as any,
    { commitment: "confirmed" }
  );
  return {
    base: new Program(idl as anchor.Idl, baseProvider),
    er: new Program(idl as anchor.Idl, erProvider),
    owner: wallet.publicKey,
  };
}

/** USDC deposit into the Mimir vault (base layer). */
export async function depositUsdc(m: BrowserMimir, units: bigint): Promise<string> {
  return m.base.methods
    .deposit(new BN(units.toString()))
    .accounts({
      user: m.owner,
      userToken: getAssociatedTokenAddressSync(USDC_MINT, m.owner, true),
    })
    .rpc();
}

/** Delegate the user's balance PDA to the MagicBlock ER. */
export async function delegateBalance(m: BrowserMimir): Promise<string> {
  return m.base.methods
    .delegateBalance()
    .accounts({ payer: m.owner, balance: balancePda(m.owner) })
    .remainingAccounts([
      { pubkey: ER_VALIDATOR, isSigner: false, isWritable: false },
    ])
    .rpc();
}

/** Zero-fee, real-time challenge inside the Ephemeral Rollup. */
export async function challengeInER(
  m: BrowserMimir,
  claimId: bigint,
  units: bigint
): Promise<string> {
  return m.er.methods
    .challengeClaim(new BN(units.toString()))
    .accounts({
      challenger: m.owner,
      claim: claimPda(claimId),
      balance: balancePda(m.owner),
    })
    .rpc({ skipPreflight: true });
}

/** Virtual balance lookup (tries ER first, then base). */
export async function getVirtualBalance(m: BrowserMimir): Promise<bigint> {
  for (const program of [m.er, m.base]) {
    try {
      const b: any = await (program.account as any).userBalance.fetch(balancePda(m.owner));
      return BigInt(b.amount.toString());
    } catch {
      // not on this layer
    }
  }
  return 0n;
}
