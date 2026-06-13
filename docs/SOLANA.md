# Mimir on Solana — program deep-dive & ops notes

The product story, architecture diagrams, and quickstart live in the
[README](../README.md). This document covers the on-chain program design,
deployed artifacts, and the build/deploy mechanics.

## Deployed artifacts (devnet)

| Thing | Value |
|---|---|
| Program | `J9MZfzQt2LVkdfvqvTRPhcSN41gSmGKDWNVjxUQPxSDR` |
| USDC mint (Circle devnet, 6 dp) | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` — fund wallets at faucet.circle.com |
| Base RPC | `https://api.devnet.solana.com` |
| ER RPC | `https://devnet-as.magicblock.app/` (router: `devnet-router.magicblock.app`) |
| ER validator | `MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57` |
| Program keypair | `onchain/target/deploy/mimir-keypair.json` (gitignored — upgrade authority, don't lose it) |

## Program design

One Anchor program (`onchain/programs/mimir`) with four account types:

| Account | Seeds | Purpose |
|---|---|---|
| `Config` | `["config"]` | admin, oracle pubkey, USDC mint, claim counter |
| `Vault` (token acct) | `["vault"]` | all escrowed USDC; authority = itself |
| `UserBalance` | `["balance", user]` | virtual betting balance; **delegated to the ER** |
| `Claim` | `["claim", id_le]` | question, positions, stakes, challenger list (max 16); **delegated to the ER** |

### Instruction map

```
Base layer only:
  initialize, set_oracle
  deposit / withdraw            — USDC ↔ vault, credits/debits UserBalance
  create_claim / cancel_claim   — USDC straight from the creator's ATA
  resolve_claim                 — oracle-only, after deadline, post-undelegation
  payout_creator / payout_challenger(i)  — permissionless pull cranks

Both layers (routed by which layer owns the PDA):
  challenge_claim               — debits UserBalance, appends to Claim

ER delegation hooks (ephemeral-rollups-sdk):
  delegate_claim / delegate_balance        — base → ER
  undelegate_claim / undelegate_balance    — commit + return to base
```

### Why the two-layer split

Token accounts can't be delegated into an Ephemeral Rollup, so USDC never
moves inside it. Deposits credit a virtual `UserBalance` PDA which *is*
delegated; `challenge_claim` mutates only delegated PDAs (balance + claim),
which is what makes it a zero-fee ~30ms ER transaction. The vault invariant
holds at all times:

```
vault = Σ free balances + Σ open-claim stakes + Σ unpaid resolved payouts
```

Payouts are pull-based (`payout_*` cranks) rather than a push loop inside
`resolve_claim` — Solana compute and account limits make per-recipient
cranks the right shape, and the oracle runs them as a service right after
resolving.

### Carried over from the original contract design

Pool odds (pro-rata challenger share of the creator stake), the 60s
anti-snipe challenge lock, confidence tiers (FIRM / CONTESTED / refund),
on-chain evidence hashes, and refund-the-ambiguous verdicts are 1:1 with
the original Mimir design. Fixed-odds mode, private claims, rematches, and
per-claim market types were intentionally left out of V1 to keep the
surface tight.

## Railway deploy (single platform)

Two services from the same repo:

**Service 1 — workers** (repo default, `railway.json`):
- Start command: `npm run workers:solana` (oracle + market-creator + council + indexer)
- `DATABASE_URL` (Neon pooler) — the indexer mirrors on-chain claim state here
  and `/api/arena/*` reads from it. Optional: without it the feed falls back to
  reading the chain directly on every request.
- Variables:
  - `SOLANA_KEYPAIR_JSON` — the admin/oracle secret key as a JSON byte array
    (paste the contents of the keypair file); no filesystem needed
  - `CREATOR_KEYPAIR_JSON` — a separate wallet for the market-creator (paste
    `.keys/creator.json`). Without it the creator falls back to the admin
    key and the oracle will skip auto-challenging its claims (the program
    rejects self-challenges).
  - `NEXT_PUBLIC_MIMIR_PROGRAM_ID`, `SOLANA_USDC_MINT`
  - `GEMINI_API_KEY`, `ORACLE_GEMINI_API_KEY`, `COUNCIL_GEMINI_API_KEY`
  - `AUTO_CHALLENGE=1`, `HEDGE_MODE=dry`, `ORACLE_LLM_THROTTLE_MS=5000`
- Council persona wallets are derived deterministically from the admin
  secret (sha256(admin ‖ slug)), so redeploys reuse the same funded wallets
  even though the container filesystem is wiped.

**Service 2 — web** (same repo, override in the dashboard):
- Build command: `npm install && npm run build`
- Start command: `npm run start:railway` (binds Next to Railway's `$PORT`)
- Variables: `NEXT_PUBLIC_MIMIR_PROGRAM_ID`, `NEXT_PUBLIC_SOLANA_USDC_MINT`.
- `/api/arena/claims` runs as a normal Node route — no serverless timeout
  concerns.

Mark `SOLANA_KEYPAIR_JSON` as sealed: it carries the admin + oracle
authority in one key. USDC funding is external — top wallets up at
https://faucet.circle.com (Solana Devnet), then `npm run system:fund`
sweeps bettor balances into the ER.

## Windows build notes (hard-won)

The Solana toolchain fights Windows in four specific ways; the working
invocation is:

```bash
cd onchain
SBF_SDK_PATH="C:\sbf-sdk" CARGO_TARGET_DIR="C:\mimir-target" anchor build -- --skip-tools-install
CARGO_TARGET_DIR="C:\mimir-target" anchor idl build -o target/idl/mimir.json
cp /c/mimir-target/deploy/mimir.so target/deploy/   # then: solana program deploy
```

1. **platform-tools install fails** (os error 183/1314): the installer wants
   a symlink, which needs Developer Mode. Fix: extract the platform-tools
   tarball manually into the SDK's `dependencies/platform-tools` dir and
   build with `--skip-tools-install`.
2. **LNK1104 on rlibs**: the default SDK path exceeds Windows' 260-char
   MAX_PATH. Fix: copy the SDK to a short path and set
   `SBF_SDK_PATH=C:\sbf-sdk`.
3. **os error 32 (file locked)**: rust-analyzer in VS Code locks
   `onchain/target`. Fix: build with `CARGO_TARGET_DIR=C:\mimir-target`.
4. `--skip-tools-install` leaks into the IDL `cargo test` invocation and
   breaks it — generate the IDL separately with `anchor idl build`.

Also note: anchor-lang 1.0 changed `CpiContext::new` to take a `Pubkey`
program id (not `AccountInfo`), and `@coral-xyz/anchor`'s ESM build doesn't
export `Wallet` — the local `KeypairWallet` in `lib/solana/client.ts` exists
because Turbopack bundles the ESM build.
