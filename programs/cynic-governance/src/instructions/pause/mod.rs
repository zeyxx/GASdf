use pinocchio::{
    account_info::AccountInfo, program_error::ProgramError, pubkey::Pubkey, ProgramResult,
};

use crate::error::*;
use crate::state::Community;

/// Pause — callable by guardian OR agent (fast freeze).
pub fn process_pause(_program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let [authority, community_account, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !authority.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let mut data = community_account.try_borrow_mut_data()?;
    let community = Community::from_bytes_mut(&mut data)?;

    if authority.key() != community.agent_pubkey() && authority.key() != community.guardian_pubkey()
    {
        return Err(governance_error(ERR_INVALID_GUARDIAN));
    }

    if community.is_paused() {
        return Err(governance_error(ERR_COMMUNITY_PAUSED));
    }

    community.paused = 1;
    Ok(())
}

/// Unpause — ONLY guardian (asymmetric safety).
pub fn process_unpause(_program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let [guardian, community_account, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !guardian.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let mut data = community_account.try_borrow_mut_data()?;
    let community = Community::from_bytes_mut(&mut data)?;

    if guardian.key() != community.guardian_pubkey() {
        return Err(governance_error(ERR_INVALID_GUARDIAN));
    }

    if !community.is_paused() {
        return Err(governance_error(ERR_COMMUNITY_NOT_PAUSED));
    }

    community.paused = 0;
    Ok(())
}
