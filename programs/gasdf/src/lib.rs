#![no_std]

use pinocchio::{
    account_info::AccountInfo, entrypoint, program_error::ProgramError, pubkey::Pubkey,
};
use pinocchio_token::instructions::{Burn, Transfer};

// Entrypoint required for Solana programs
entrypoint!(process_instruction);

/// On-chain GASdf logic
/// Accounts Expected:
/// 0. `[Writable]` user_token_account
/// 1. `[Signer]` user_authority
/// 2. `[Writable]` treasury_token_account
/// 3. `[Writable]` mint_account
/// 4. `[]` token_program
pub fn process_instruction(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> Result<(), ProgramError> {
    if instruction_data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }

    let instruction_type = instruction_data[0];

    match instruction_type {
        0 => process_pay_fee(accounts, &instruction_data[1..])?,
        _ => return Err(ProgramError::InvalidInstructionData),
    }

    Ok(())
}

fn process_pay_fee(accounts: &[AccountInfo], data: &[u8]) -> Result<(), ProgramError> {
    if accounts.len() < 5 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    if data.len() < 9 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let user_token_account = &accounts[0];
    let user_authority = &accounts[1];
    let treasury_token_account = &accounts[2];
    let mint_account = &accounts[3];
    let _token_program = &accounts[4];

    if !user_authority.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Parse amount (8 bytes, little endian)
    let amount_bytes: [u8; 8] = data[0..8].try_into().unwrap();
    let total_amount = u64::from_le_bytes(amount_bytes);

    // Parse token type (1 byte: 1 = ASDF, 0 = Other)
    let is_asdf = data[8] == 1;

    if is_asdf {
        // ASDF logic: split based on Golden Ratio phi (1/phi^3 = ~23.6%)
        // 236068 / 1000000 = 23.6068%
        let treasury_amount = (total_amount as u128 * 236068 / 1000000) as u64;
        let burn_amount = total_amount.saturating_sub(treasury_amount);

        // 1. Transfer to treasury
        if treasury_amount > 0 {
            Transfer {
                from: user_token_account,
                to: treasury_token_account,
                authority: user_authority,
                amount: treasury_amount,
            }
            .invoke()?;
        }

        // 2. Burn the rest
        if burn_amount > 0 {
            Burn {
                account: user_token_account,
                mint: mint_account,
                authority: user_authority,
                amount: burn_amount,
            }
            .invoke()?;
        }
    } else {
        // Other tokens (USDC, USDT, etc.): Transfer 100% to treasury
        // The off-chain worker will later swap and burn
        Transfer {
            from: user_token_account,
            to: treasury_token_account,
            authority: user_authority,
            amount: total_amount,
        }
        .invoke()?;
    }

    Ok(())
}
