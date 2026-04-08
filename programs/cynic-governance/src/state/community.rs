use pinocchio::{program_error::ProgramError, pubkey::Pubkey};

/// Community — one per governed token.
///
/// PDA seeds: ["community", mint_pubkey]
///
/// Layout: [disc: u8 | version: u8 | data...]
/// Total: 2 + 137 = 139 bytes
#[repr(C)]
pub struct Community {
    pub bump: u8,            // 1
    pub paused: u8,          // 1
    pub mint: [u8; 32],      // 32
    pub agent: [u8; 32],     // 32
    pub guardian: [u8; 32],  // 32
    pub threshold: u16,      // 2  — min q_score basis points
    pub timelock_slots: u32, // 4
    pub total_verdicts: u32, // 4
    pub _reserved: [u8; 0],
}

const _: () = assert!(core::mem::size_of::<Community>() == 108);

pub const COMMUNITY_DISC: u8 = 0;
pub const COMMUNITY_VERSION: u8 = 1;
pub const COMMUNITY_LEN: usize = 2 + 108;
pub const COMMUNITY_SEED: &[u8] = b"community";

impl Community {
    pub fn from_bytes(data: &[u8]) -> Result<&Self, ProgramError> {
        if data.len() < COMMUNITY_LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        if data[0] != COMMUNITY_DISC {
            return Err(ProgramError::InvalidAccountData);
        }
        Ok(unsafe { &*(data[2..].as_ptr() as *const Self) })
    }

    pub fn from_bytes_mut(data: &mut [u8]) -> Result<&mut Self, ProgramError> {
        if data.len() < COMMUNITY_LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        if data[0] != COMMUNITY_DISC {
            return Err(ProgramError::InvalidAccountData);
        }
        Ok(unsafe { &mut *(data[2..].as_mut_ptr() as *mut Self) })
    }

    pub fn is_paused(&self) -> bool {
        self.paused != 0
    }

    pub fn agent_pubkey(&self) -> &Pubkey {
        unsafe { &*(self.agent.as_ptr() as *const Pubkey) }
    }

    pub fn guardian_pubkey(&self) -> &Pubkey {
        unsafe { &*(self.guardian.as_ptr() as *const Pubkey) }
    }

    pub fn mint_pubkey(&self) -> &Pubkey {
        unsafe { &*(self.mint.as_ptr() as *const Pubkey) }
    }
}
