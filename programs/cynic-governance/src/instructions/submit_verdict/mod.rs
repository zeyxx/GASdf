use pinocchio::{
    account_info::AccountInfo,
    instruction::{Seed, Signer},
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{clock::Clock, rent::Rent, Sysvar},
    ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;

use crate::error::*;
use crate::state::{
    Community, Verdict, VerdictType, VERDICT_DISC, VERDICT_LEN, VERDICT_SEED, VERDICT_VERSION,
};

/// Submit a CYNIC verdict on-chain.
///
/// Accounts:
///   0. [signer, writable] agent
///   1. [writable]          community PDA
///   2. [writable]          verdict PDA (to create)
///   3. []                  system_program
///
/// Data (48 bytes):
///   [0..32]  proposal_hash
///   [32..34] q_score (u16 bp)
///   [34..46] 6 axiom scores (u16 bp each)
///   [46]     dog_count (u8)
///   [47]     verdict_type (u8)
pub fn process(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let [agent, community_account, verdict_account, _system_program, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !agent.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Load community
    let community_data = community_account.try_borrow_data()?;
    let community = Community::from_bytes(&community_data)?;

    if community.is_paused() {
        return Err(governance_error(ERR_COMMUNITY_PAUSED));
    }
    if agent.key() != community.agent_pubkey() {
        return Err(governance_error(ERR_INVALID_AGENT));
    }

    // Parse data
    if data.len() < 48 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let mut proposal_hash = [0u8; 32];
    proposal_hash.copy_from_slice(&data[0..32]);
    let q_score = u16::from_le_bytes([data[32], data[33]]);
    let fidelity = u16::from_le_bytes([data[34], data[35]]);
    let phi = u16::from_le_bytes([data[36], data[37]]);
    let verify = u16::from_le_bytes([data[38], data[39]]);
    let culture = u16::from_le_bytes([data[40], data[41]]);
    let burn_score = u16::from_le_bytes([data[42], data[43]]);
    let sovereignty = u16::from_le_bytes([data[44], data[45]]);
    let dog_count = data[46];
    let verdict_type_raw = data[47];

    let _vtype = VerdictType::try_from(verdict_type_raw)?;

    // φ⁻¹ ceiling: 6180 basis points
    if q_score > 6180 {
        return Err(ProgramError::InvalidInstructionData);
    }

    // Derive verdict PDA
    let (expected, bump) = crate::find_pda(
        &[
            VERDICT_SEED,
            community_account.key().as_ref(),
            &proposal_hash,
        ],
        program_id,
    );
    if verdict_account.key() != &expected {
        return Err(ProgramError::InvalidSeeds);
    }

    // Create verdict PDA
    let rent = Rent::get()?;
    let lamports = rent.minimum_balance(VERDICT_LEN);

    let bump_seed = [bump];
    let seeds = [
        Seed::from(VERDICT_SEED),
        Seed::from(community_account.key().as_ref()),
        Seed::from(&proposal_hash[..]),
        Seed::from(&bump_seed),
    ];
    let signer = [Signer::from(&seeds)];

    CreateAccount {
        from: agent,
        to: verdict_account,
        lamports,
        space: VERDICT_LEN as u64,
        owner: program_id,
    }
    .invoke_signed(&signer)?;

    // Clock
    let clock = Clock::get()?;

    // Write verdict
    let mut vdata = verdict_account.try_borrow_mut_data()?;
    vdata[0] = VERDICT_DISC;
    vdata[1] = VERDICT_VERSION;

    let verdict = Verdict::from_bytes_mut(&mut vdata)?;
    verdict.bump = bump;
    verdict.verdict_type = verdict_type_raw;
    verdict
        .community
        .copy_from_slice(community_account.key().as_ref());
    verdict.proposal_hash = proposal_hash;
    verdict.q_score = q_score;
    verdict.fidelity = fidelity;
    verdict.phi = phi;
    verdict.verify = verify;
    verdict.culture = culture;
    verdict.burn = burn_score;
    verdict.sovereignty = sovereignty;
    verdict.dog_count = dog_count;
    verdict.timestamp = clock.unix_timestamp;
    verdict.executed = 0;

    // Increment counter
    drop(community_data);
    let mut cdata = community_account.try_borrow_mut_data()?;
    let cmut = Community::from_bytes_mut(&mut cdata)?;
    cmut.total_verdicts = cmut
        .total_verdicts
        .checked_add(1)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    Ok(())
}
