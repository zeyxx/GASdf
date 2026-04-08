use pinocchio::{
    account_info::AccountInfo,
    instruction::{Seed, Signer},
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{rent::Rent, Sysvar},
    ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;

use crate::error::*;
use crate::state::{Community, COMMUNITY_DISC, COMMUNITY_LEN, COMMUNITY_SEED, COMMUNITY_VERSION};

/// Initialize a new community for AI governance.
///
/// Accounts:
///   0. [signer, writable] payer
///   1. [writable]          community PDA
///   2. []                  mint
///   3. []                  agent pubkey
///   4. []                  guardian pubkey
///   5. []                  system_program
///
/// Data: [threshold: u16, timelock_slots: u32]
pub fn process(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let [payer, community_account, mint, agent, guardian, _system_program, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !payer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Must be uninitialized
    if community_account.data_len() > 0 {
        return Err(governance_error(ERR_COMMUNITY_ALREADY_INITIALIZED));
    }

    // Parse data
    if data.len() < 6 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let threshold = u16::from_le_bytes([data[0], data[1]]);
    let timelock_slots = u32::from_le_bytes([data[2], data[3], data[4], data[5]]);

    // Derive PDA
    let (expected, bump) = crate::find_pda(&[COMMUNITY_SEED, mint.key().as_ref()], program_id);
    if community_account.key() != &expected {
        return Err(ProgramError::InvalidSeeds);
    }

    // Create PDA
    let rent = Rent::get()?;
    let lamports = rent.minimum_balance(COMMUNITY_LEN);

    let bump_seed = [bump];
    let seeds = [
        Seed::from(COMMUNITY_SEED),
        Seed::from(mint.key().as_ref()),
        Seed::from(&bump_seed),
    ];
    let signer = [Signer::from(&seeds)];

    CreateAccount {
        from: payer,
        to: community_account,
        lamports,
        space: COMMUNITY_LEN as u64,
        owner: program_id,
    }
    .invoke_signed(&signer)?;

    // Write state
    let mut data = community_account.try_borrow_mut_data()?;
    data[0] = COMMUNITY_DISC;
    data[1] = COMMUNITY_VERSION;

    let community = Community::from_bytes_mut(&mut data)?;
    community.bump = bump;
    community.paused = 0;
    community.mint.copy_from_slice(mint.key().as_ref());
    community.agent.copy_from_slice(agent.key().as_ref());
    community.guardian.copy_from_slice(guardian.key().as_ref());
    community.threshold = threshold;
    community.timelock_slots = timelock_slots;
    community.total_verdicts = 0;

    Ok(())
}
