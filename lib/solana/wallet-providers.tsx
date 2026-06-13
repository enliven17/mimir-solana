"use client";

/**
 * Solana wallet context (app-wide, from the root layout).
 *
 * The wallet list is intentionally empty: modern Phantom / Solflare / Backpack
 * register themselves through the Wallet Standard, so the adapter discovers
 * them automatically. This avoids pulling the legacy per-wallet adapter
 * packages — in particular the Ledger adapter's `usb` native module, which
 * needs a C/Python toolchain to build and breaks clean container installs.
 */
import { ReactNode } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { SOLANA_RPC } from "./config";

import "@solana/wallet-adapter-react-ui/styles.css";

export function SolanaWalletProviders({ children }: { children: ReactNode }) {
  return (
    <ConnectionProvider endpoint={SOLANA_RPC} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
