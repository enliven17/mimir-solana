use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;

declare_id!("J9MZfzQt2LVkdfvqvTRPhcSN41gSmGKDWNVjxUQPxSDR");

pub const CONFIG_SEED: &[u8] = b"config";
pub const VAULT_SEED: &[u8] = b"vault";
pub const BALANCE_SEED: &[u8] = b"balance";
pub const CLAIM_SEED: &[u8] = b"claim";

/// 2 USDC minimum stake (6 decimals on Solana, not 18 like Arc)
pub const MIN_STAKE: u64 = 2_000_000;
/// Anti-sniping: no challenges in the final 60s before the deadline
pub const CHALLENGE_LOCK_SECONDS: i64 = 60;
pub const MAX_CHALLENGERS: u8 = 16;

// Claim states
pub const ST_OPEN: u8 = 0;
pub const ST_ACTIVE: u8 = 1;
pub const ST_RESOLVED: u8 = 2;
pub const ST_CANCELLED: u8 = 3;

// Winner sides
pub const SIDE_NONE: u8 = 0;
pub const SIDE_CREATOR: u8 = 1;
pub const SIDE_CHALLENGERS: u8 = 2;
pub const SIDE_DRAW: u8 = 3;
pub const SIDE_UNRESOLVABLE: u8 = 4;

#[ephemeral]
#[program]
pub mod mimir {
    use super::*;

    // ── Base layer: setup ─────────────────────────────────────────────────

    pub fn initialize(ctx: Context<Initialize>, oracle: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.oracle = oracle;
        config.usdc_mint = ctx.accounts.usdc_mint.key();
        config.claim_count = 0;
        config.total_resolved = 0;
        config.vault_bump = ctx.bumps.vault;
        Ok(())
    }

    pub fn set_oracle(ctx: Context<SetOracle>, oracle: Pubkey) -> Result<()> {
        ctx.accounts.config.oracle = oracle;
        Ok(())
    }

    // ── Base layer: USDC escrow ───────────────────────────────────────────

    /// Deposit USDC into the vault; credits the caller's virtual balance.
    /// The balance PDA is what gets delegated into the Ephemeral Rollup.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, MimirError::InvalidAmount);
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.user_token.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;
        let balance = &mut ctx.accounts.balance;
        balance.owner = ctx.accounts.user.key();
        balance.amount = balance
            .amount
            .checked_add(amount)
            .ok_or(MimirError::MathOverflow)?;
        Ok(())
    }

    /// Withdraw free (unstaked) balance back to the user's token account.
    /// Only possible while the balance PDA is NOT delegated.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let balance = &mut ctx.accounts.balance;
        require!(balance.amount >= amount, MimirError::InsufficientBalance);
        balance.amount -= amount;
        transfer_from_vault(
            &ctx.accounts.token_program,
            &ctx.accounts.vault,
            &ctx.accounts.user_token,
            ctx.accounts.config.vault_bump,
            amount,
        )
    }

    // ── Base layer: claim lifecycle ───────────────────────────────────────

    /// Create a claim. Creator stake moves straight from the creator's
    /// token account into the vault (no virtual balance needed on this side).
    pub fn create_claim(ctx: Context<CreateClaim>, args: CreateClaimArgs) -> Result<()> {
        require!(args.stake_amount >= MIN_STAKE, MimirError::StakeTooSmall);
        let now = Clock::get()?.unix_timestamp;
        require!(args.deadline > now, MimirError::DeadlineInPast);
        require!(!args.question.is_empty(), MimirError::EmptyQuestion);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.creator_token.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.creator.to_account_info(),
                },
            ),
            args.stake_amount,
        )?;

        let config = &mut ctx.accounts.config;
        config.claim_count += 1;

        let claim = &mut ctx.accounts.claim;
        claim.id = config.claim_count;
        claim.bump = ctx.bumps.claim;
        claim.creator = ctx.accounts.creator.key();
        claim.question = args.question;
        claim.creator_position = args.creator_position;
        claim.counter_position = args.counter_position;
        claim.resolution_url = args.resolution_url;
        claim.category = args.category;
        claim.creator_stake = args.stake_amount;
        claim.total_challenger_stake = 0;
        claim.deadline = args.deadline;
        claim.state = ST_OPEN;
        claim.winner_side = SIDE_NONE;
        claim.resolution_summary = String::new();
        claim.confidence = 0;
        claim.evidence_hash = [0u8; 32];
        claim.created_at = now;
        claim.max_challengers = if args.max_challengers == 0 || args.max_challengers > MAX_CHALLENGERS
        {
            MAX_CHALLENGERS
        } else {
            args.max_challengers
        };
        claim.creator_paid = false;
        claim.challengers = Vec::new();
        Ok(())
    }

    /// Cancel an OPEN claim (no challengers yet). Base layer only.
    pub fn cancel_claim(ctx: Context<CancelClaim>) -> Result<()> {
        let claim = &mut ctx.accounts.claim;
        require!(claim.state == ST_OPEN, MimirError::NotOpen);
        require!(claim.challengers.is_empty(), MimirError::HasChallengers);
        claim.state = ST_CANCELLED;
        let amount = claim.creator_stake;
        transfer_from_vault(
            &ctx.accounts.token_program,
            &ctx.accounts.vault,
            &ctx.accounts.creator_token,
            ctx.accounts.config.vault_bump,
            amount,
        )
    }

    // ── Works on BOTH layers (routed by Magic Router) ─────────────────────

    /// Challenge a claim by staking from the virtual balance.
    /// Designed to run inside the Ephemeral Rollup: both the claim PDA and
    /// the challenger's balance PDA are delegated, so this is a zero-fee,
    /// ~30ms transaction. It also works on the base layer pre-delegation.
    pub fn challenge_claim(ctx: Context<ChallengeClaim>, stake_amount: u64) -> Result<()> {
        let claim = &mut ctx.accounts.claim;
        let balance = &mut ctx.accounts.balance;
        let challenger = ctx.accounts.challenger.key();
        let now = Clock::get()?.unix_timestamp;

        require!(
            claim.state == ST_OPEN || claim.state == ST_ACTIVE,
            MimirError::NotOpen
        );
        require!(challenger != claim.creator, MimirError::SelfChallenge);
        require!(
            !claim.challengers.iter().any(|c| c.addr == challenger),
            MimirError::AlreadyChallenged
        );
        require!(
            (claim.challengers.len() as u8) < claim.max_challengers,
            MimirError::ClaimFull
        );
        require!(stake_amount >= MIN_STAKE, MimirError::StakeTooSmall);
        require!(
            now + CHALLENGE_LOCK_SECONDS <= claim.deadline,
            MimirError::ChallengeWindowClosed
        );
        require!(
            balance.amount >= stake_amount,
            MimirError::InsufficientBalance
        );

        balance.amount -= stake_amount;
        claim.total_challenger_stake = claim
            .total_challenger_stake
            .checked_add(stake_amount)
            .ok_or(MimirError::MathOverflow)?;
        claim.challengers.push(Challenger {
            addr: challenger,
            stake: stake_amount,
            paid: false,
        });
        claim.state = ST_ACTIVE;
        Ok(())
    }

    // ── Base layer: resolution (oracle only, post-undelegation) ───────────

    pub fn resolve_claim(
        ctx: Context<ResolveClaim>,
        winner_side: u8,
        summary: String,
        confidence: u8,
        evidence_hash: [u8; 32],
    ) -> Result<()> {
        let claim = &mut ctx.accounts.claim;
        require!(claim.state == ST_ACTIVE, MimirError::NotActive);
        let now = Clock::get()?.unix_timestamp;
        require!(now >= claim.deadline, MimirError::NotYetExpired);
        require!(
            winner_side == SIDE_CREATOR
                || winner_side == SIDE_CHALLENGERS
                || winner_side == SIDE_DRAW
                || winner_side == SIDE_UNRESOLVABLE,
            MimirError::InvalidVerdict
        );
        require!(summary.len() <= 300, MimirError::SummaryTooLong);

        claim.state = ST_RESOLVED;
        claim.winner_side = winner_side;
        claim.resolution_summary = summary;
        claim.confidence = confidence;
        claim.evidence_hash = evidence_hash;
        ctx.accounts.config.total_resolved += 1;
        Ok(())
    }

    /// Pay out the creator's share after resolution. Permissionless crank —
    /// anyone can run it, USDC always goes to the creator's token account.
    pub fn payout_creator(ctx: Context<PayoutCreator>) -> Result<()> {
        let claim = &mut ctx.accounts.claim;
        require!(claim.state == ST_RESOLVED, MimirError::NotResolved);
        require!(!claim.creator_paid, MimirError::AlreadyPaid);

        let amount = match claim.winner_side {
            SIDE_CREATOR => claim
                .creator_stake
                .checked_add(claim.total_challenger_stake)
                .ok_or(MimirError::MathOverflow)?,
            SIDE_DRAW | SIDE_UNRESOLVABLE => claim.creator_stake,
            _ => return err!(MimirError::NothingToPay),
        };
        claim.creator_paid = true;
        transfer_from_vault(
            &ctx.accounts.token_program,
            &ctx.accounts.vault,
            &ctx.accounts.creator_token,
            ctx.accounts.config.vault_bump,
            amount,
        )
    }

    /// Pay out one challenger by index. Pool odds: stake + proportional
    /// share of the creator stake. Permissionless crank.
    pub fn payout_challenger(ctx: Context<PayoutChallenger>, index: u8) -> Result<()> {
        let claim = &mut ctx.accounts.claim;
        require!(claim.state == ST_RESOLVED, MimirError::NotResolved);
        let i = index as usize;
        require!(i < claim.challengers.len(), MimirError::BadIndex);
        require!(!claim.challengers[i].paid, MimirError::AlreadyPaid);
        require!(
            claim.challengers[i].addr == ctx.accounts.challenger_token.owner,
            MimirError::WrongRecipient
        );

        let stake = claim.challengers[i].stake;
        let amount = match claim.winner_side {
            SIDE_CHALLENGERS => {
                let share = (stake as u128)
                    .checked_mul(claim.creator_stake as u128)
                    .ok_or(MimirError::MathOverflow)?
                    / (claim.total_challenger_stake as u128);
                stake
                    .checked_add(share as u64)
                    .ok_or(MimirError::MathOverflow)?
            }
            SIDE_DRAW | SIDE_UNRESOLVABLE => stake,
            _ => return err!(MimirError::NothingToPay),
        };
        claim.challengers[i].paid = true;
        transfer_from_vault(
            &ctx.accounts.token_program,
            &ctx.accounts.vault,
            &ctx.accounts.challenger_token,
            ctx.accounts.config.vault_bump,
            amount,
        )
    }

    // ── MagicBlock ER: delegation hooks ───────────────────────────────────

    /// Delegate a claim PDA into the Ephemeral Rollup. From this point on,
    /// challenges against it run in real time with zero fees.
    pub fn delegate_claim(ctx: Context<DelegateClaim>, claim_id: u64) -> Result<()> {
        ctx.accounts.delegate_claim(
            &ctx.accounts.payer,
            &[CLAIM_SEED, &claim_id.to_le_bytes()],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|acc| acc.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// Delegate the caller's balance PDA into the Ephemeral Rollup so they
    /// can challenge claims inside the ER.
    pub fn delegate_balance(ctx: Context<DelegateBalance>) -> Result<()> {
        let payer_key = ctx.accounts.payer.key();
        ctx.accounts.delegate_balance(
            &ctx.accounts.payer,
            &[BALANCE_SEED, payer_key.as_ref()],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|acc| acc.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// Commit + undelegate a claim from the ER back to the base layer.
    /// Run by the oracle once the deadline passes, right before resolution.
    pub fn undelegate_claim(ctx: Context<UndelegateClaim>) -> Result<()> {
        ctx.accounts.claim.exit(&crate::ID)?;
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.claim.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }

    /// Commit + undelegate the caller's balance PDA (needed before withdraw).
    pub fn undelegate_balance(ctx: Context<UndelegateBalance>) -> Result<()> {
        ctx.accounts.balance.exit(&crate::ID)?;
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.balance.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────

fn transfer_from_vault<'info>(
    token_program: &Program<'info, Token>,
    vault: &Account<'info, TokenAccount>,
    to: &Account<'info, TokenAccount>,
    vault_bump: u8,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let seeds: &[&[u8]] = &[VAULT_SEED, &[vault_bump]];
    token::transfer(
        CpiContext::new_with_signer(
            token_program.key(),
            Transfer {
                from: vault.to_account_info(),
                to: to.to_account_info(),
                authority: vault.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )
}

// ── Instruction args ──────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateClaimArgs {
    pub question: String,         // max 200
    pub creator_position: String, // max 100
    pub counter_position: String, // max 100
    pub resolution_url: String,   // max 200
    pub category: String,         // max 32
    pub stake_amount: u64,
    pub deadline: i64,
    pub max_challengers: u8,
}

// ── State ─────────────────────────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub oracle: Pubkey,
    pub usdc_mint: Pubkey,
    pub claim_count: u64,
    pub total_resolved: u64,
    pub vault_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct UserBalance {
    pub owner: Pubkey,
    pub amount: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct Challenger {
    pub addr: Pubkey,
    pub stake: u64,
    pub paid: bool,
}

#[account]
#[derive(InitSpace)]
pub struct Claim {
    pub id: u64,
    pub bump: u8,
    pub creator: Pubkey,
    #[max_len(200)]
    pub question: String,
    #[max_len(100)]
    pub creator_position: String,
    #[max_len(100)]
    pub counter_position: String,
    #[max_len(200)]
    pub resolution_url: String,
    #[max_len(32)]
    pub category: String,
    pub creator_stake: u64,
    pub total_challenger_stake: u64,
    pub deadline: i64,
    pub state: u8,
    pub winner_side: u8,
    #[max_len(300)]
    pub resolution_summary: String,
    pub confidence: u8,
    pub evidence_hash: [u8; 32],
    pub created_at: i64,
    pub max_challengers: u8,
    pub creator_paid: bool,
    #[max_len(16)]
    pub challengers: Vec<Challenger>,
}

// ── Contexts ──────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,
    pub usdc_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = admin,
        seeds = [VAULT_SEED],
        bump,
        token::mint = usdc_mint,
        token::authority = vault
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetOracle<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump, has_one = admin)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserBalance::INIT_SPACE,
        seeds = [BALANCE_SEED, user.key().as_ref()],
        bump
    )]
    pub balance: Account<'info, UserBalance>,
    #[account(mut, token::mint = config.usdc_mint, token::authority = user)]
    pub user_token: Account<'info, TokenAccount>,
    #[account(mut, seeds = [VAULT_SEED], bump = config.vault_bump)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub user: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [BALANCE_SEED, user.key().as_ref()], bump, has_one = owner @ MimirError::WrongRecipient)]
    pub balance: Account<'info, UserBalance>,
    /// CHECK: constrained via has_one on balance
    pub owner: UncheckedAccount<'info>,
    #[account(mut, token::mint = config.usdc_mint)]
    pub user_token: Account<'info, TokenAccount>,
    #[account(mut, seeds = [VAULT_SEED], bump = config.vault_bump)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CreateClaim<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = creator,
        space = 8 + Claim::INIT_SPACE,
        seeds = [CLAIM_SEED, &(config.claim_count + 1).to_le_bytes()],
        bump
    )]
    pub claim: Account<'info, Claim>,
    #[account(mut, token::mint = config.usdc_mint, token::authority = creator)]
    pub creator_token: Account<'info, TokenAccount>,
    #[account(mut, seeds = [VAULT_SEED], bump = config.vault_bump)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelClaim<'info> {
    pub creator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [CLAIM_SEED, &claim.id.to_le_bytes()],
        bump = claim.bump,
        has_one = creator @ MimirError::NotCreator
    )]
    pub claim: Account<'info, Claim>,
    #[account(mut, token::mint = config.usdc_mint, token::authority = creator)]
    pub creator_token: Account<'info, TokenAccount>,
    #[account(mut, seeds = [VAULT_SEED], bump = config.vault_bump)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ChallengeClaim<'info> {
    pub challenger: Signer<'info>,
    #[account(mut, seeds = [CLAIM_SEED, &claim.id.to_le_bytes()], bump = claim.bump)]
    pub claim: Account<'info, Claim>,
    #[account(mut, seeds = [BALANCE_SEED, challenger.key().as_ref()], bump)]
    pub balance: Account<'info, UserBalance>,
}

#[derive(Accounts)]
pub struct ResolveClaim<'info> {
    pub oracle: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump, has_one = oracle @ MimirError::NotOracle)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [CLAIM_SEED, &claim.id.to_le_bytes()], bump = claim.bump)]
    pub claim: Account<'info, Claim>,
}

#[derive(Accounts)]
pub struct PayoutCreator<'info> {
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [CLAIM_SEED, &claim.id.to_le_bytes()], bump = claim.bump)]
    pub claim: Account<'info, Claim>,
    #[account(
        mut,
        token::mint = config.usdc_mint,
        constraint = creator_token.owner == claim.creator @ MimirError::WrongRecipient
    )]
    pub creator_token: Account<'info, TokenAccount>,
    #[account(mut, seeds = [VAULT_SEED], bump = config.vault_bump)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct PayoutChallenger<'info> {
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [CLAIM_SEED, &claim.id.to_le_bytes()], bump = claim.bump)]
    pub claim: Account<'info, Claim>,
    #[account(mut, token::mint = config.usdc_mint)]
    pub challenger_token: Account<'info, TokenAccount>,
    #[account(mut, seeds = [VAULT_SEED], bump = config.vault_bump)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

/// Delegation contexts — the #[delegate] macro injects delegate_<field>()
#[delegate]
#[derive(Accounts)]
#[instruction(claim_id: u64)]
pub struct DelegateClaim<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: the claim PDA to delegate, validated by seeds in delegate_claim()
    #[account(mut, del, seeds = [CLAIM_SEED, &claim_id.to_le_bytes()], bump)]
    pub claim: AccountInfo<'info>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateBalance<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: the caller's balance PDA, validated by seeds in delegate_balance()
    #[account(mut, del, seeds = [BALANCE_SEED, payer.key().as_ref()], bump)]
    pub balance: AccountInfo<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct UndelegateClaim<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [CLAIM_SEED, &claim.id.to_le_bytes()], bump = claim.bump)]
    pub claim: Account<'info, Claim>,
}

#[commit]
#[derive(Accounts)]
pub struct UndelegateBalance<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [BALANCE_SEED, payer.key().as_ref()], bump)]
    pub balance: Account<'info, UserBalance>,
}

// ── Errors ────────────────────────────────────────────────────────────────

#[error_code]
pub enum MimirError {
    #[msg("Mimir: invalid amount")]
    InvalidAmount,
    #[msg("Mimir: stake too small")]
    StakeTooSmall,
    #[msg("Mimir: deadline in past")]
    DeadlineInPast,
    #[msg("Mimir: empty question")]
    EmptyQuestion,
    #[msg("Mimir: claim not open")]
    NotOpen,
    #[msg("Mimir: claim not active")]
    NotActive,
    #[msg("Mimir: claim not resolved")]
    NotResolved,
    #[msg("Mimir: not yet expired")]
    NotYetExpired,
    #[msg("Mimir: invalid verdict")]
    InvalidVerdict,
    #[msg("Mimir: self-challenge")]
    SelfChallenge,
    #[msg("Mimir: already challenged")]
    AlreadyChallenged,
    #[msg("Mimir: claim is full")]
    ClaimFull,
    #[msg("Mimir: challenge window closed")]
    ChallengeWindowClosed,
    #[msg("Mimir: insufficient balance")]
    InsufficientBalance,
    #[msg("Mimir: math overflow")]
    MathOverflow,
    #[msg("Mimir: not the oracle")]
    NotOracle,
    #[msg("Mimir: not the creator")]
    NotCreator,
    #[msg("Mimir: already paid")]
    AlreadyPaid,
    #[msg("Mimir: nothing to pay")]
    NothingToPay,
    #[msg("Mimir: bad challenger index")]
    BadIndex,
    #[msg("Mimir: wrong recipient")]
    WrongRecipient,
    #[msg("Mimir: claim has challengers")]
    HasChallengers,
    #[msg("Mimir: summary too long")]
    SummaryTooLong,
}
