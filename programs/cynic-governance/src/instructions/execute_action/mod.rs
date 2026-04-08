use pinocchio::{
    account_info::AccountInfo,
    instruction::{Seed, Signer},
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};
use pinocchio_token::instructions::BurnChecked;

use crate::error::*;
use crate::state::{Community, Verdict, VerdictType, COMMUNITY_SEED};

/// Execute an action after a positive verdict + timelock.
///
/// Accounts (action 0 — burn):
///   0. [signer]   agent
///   1. [writable]  community PDA
///   2. [writable]  verdict PDA
///   3. [writable]  token_account (ATA owned by community PDA)
///   4. [writable]  mint
///   5. []          token_program
///
/// Accounts (action 1 — threshold change):
///   0. [signer]   agent
///   1. [writable]  community PDA
///   2. [writable]  verdict PDA
///
/// Data (action 0): [0, amount: u64, decimals: u8]
/// Data (action 1): [1, new_threshold: u16]
pub fn process(_program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    // Need at least 3 accounts for all action types
    if accounts.len() < 3 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    let agent = &accounts[0];
    let community_account = &accounts[1];
    let verdict_account = &accounts[2];

    if !agent.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Parse action type early to validate account count
    if data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }
    let action_type = data[0];

    // Burn requires extra accounts
    if action_type == 0 && accounts.len() < 6 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    // Load community (read-only first for validation)
    let community_data = community_account.try_borrow_data()?;
    let community = Community::from_bytes(&community_data)?;

    if community.is_paused() {
        return Err(governance_error(ERR_COMMUNITY_PAUSED));
    }
    if agent.key() != community.agent_pubkey() {
        return Err(governance_error(ERR_INVALID_AGENT));
    }

    // Snapshot values we need before dropping the borrow
    let community_threshold = community.threshold;
    let community_bump = community.bump;
    let community_mint = community.mint;

    // Load verdict
    let mut vdata = verdict_account.try_borrow_mut_data()?;
    let verdict = Verdict::from_bytes_mut(&mut vdata)?;

    if &verdict.community != community_account.key().as_ref() {
        return Err(governance_error(ERR_INVALID_VERDICT_FOR_ACTION));
    }
    if verdict.is_executed() {
        return Err(governance_error(ERR_INVALID_VERDICT_FOR_ACTION));
    }
    if verdict.q_score < community_threshold {
        return Err(governance_error(ERR_VERDICT_BELOW_THRESHOLD));
    }

    let vtype = verdict.verdict_type()?;
    if vtype != VerdictType::Howl && vtype != VerdictType::Wag {
        return Err(governance_error(ERR_VERDICT_BELOW_THRESHOLD));
    }

    // Timelock check
    let clock = Clock::get()?;
    let timelock_seconds = (community.timelock_slots as i64) / 2;
    let elapsed = clock.unix_timestamp.saturating_sub(verdict.timestamp);
    if elapsed < timelock_seconds {
        return Err(governance_error(ERR_TIMELOCK_NOT_ELAPSED));
    }

    // Mark executed before action (prevents reentrancy)
    verdict.executed = 1;

    // Drop borrows we no longer need
    drop(community_data);

    match action_type {
        // Action 0: Burn tokens
        0 => {
            if data.len() < 10 {
                return Err(ProgramError::InvalidInstructionData);
            }
            let amount = u64::from_le_bytes(
                data[1..9]
                    .try_into()
                    .map_err(|_| ProgramError::InvalidInstructionData)?,
            );
            let decimals = data[9];

            let bump_bytes = [community_bump];
            let seeds = [
                Seed::from(COMMUNITY_SEED),
                Seed::from(&community_mint[..]),
                Seed::from(&bump_bytes),
            ];
            let signer = [Signer::from(&seeds)];

            let token_account = &accounts[3];
            let mint = &accounts[4];

            BurnChecked {
                account: token_account,
                mint,
                authority: community_account,
                amount,
                decimals,
            }
            .invoke_signed(&signer)?;
        }

        // Action 1: Change community threshold
        1 => {
            if data.len() < 3 {
                return Err(ProgramError::InvalidInstructionData);
            }
            let new_threshold = u16::from_le_bytes([data[1], data[2]]);

            // φ⁻¹ ceiling: max threshold 6180 bp
            if new_threshold > 6180 {
                return Err(ProgramError::InvalidInstructionData);
            }

            let mut cdata = community_account.try_borrow_mut_data()?;
            let cmut = Community::from_bytes_mut(&mut cdata)?;
            cmut.threshold = new_threshold;
        }

        _ => return Err(governance_error(ERR_INVALID_ACTION_TYPE)),
    }

    Ok(())
}
