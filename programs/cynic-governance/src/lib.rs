use pinocchio::{
    account_info::AccountInfo, entrypoint, program_error::ProgramError, pubkey::Pubkey,
    ProgramResult,
};

pub mod error;
pub mod instructions;
pub mod state;

pub use instructions::*;

// Program ID — will be replaced after first deploy
pub const ID: Pubkey = five8_const::decode_32_const("A4QK3jj2kDx6w3da7FF3wxiBMnD2NrDsL1F7RCJA5NXx");

entrypoint!(process_instruction);

fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    match instruction_data.split_first() {
        Some((0, data)) => instructions::initialize_community::process(program_id, accounts, data),
        Some((1, data)) => instructions::submit_verdict::process(program_id, accounts, data),
        Some((2, data)) => instructions::execute_action::process(program_id, accounts, data),
        Some((3, _)) => instructions::pause::process_pause(program_id, accounts),
        Some((4, _)) => instructions::pause::process_unpause(program_id, accounts),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

// Re-export PDA derivation
pub use pinocchio::pubkey::find_program_address as find_pda;
