use pinocchio::program_error::ProgramError;

#[repr(u8)]
#[derive(Clone, Copy, PartialEq)]
pub enum VerdictType {
    Howl = 0,
    Wag = 1,
    Growl = 2,
    Bark = 3,
}

impl TryFrom<u8> for VerdictType {
    type Error = ProgramError;
    fn try_from(v: u8) -> Result<Self, Self::Error> {
        match v {
            0 => Ok(VerdictType::Howl),
            1 => Ok(VerdictType::Wag),
            2 => Ok(VerdictType::Growl),
            3 => Ok(VerdictType::Bark),
            _ => Err(ProgramError::InvalidInstructionData),
        }
    }
}

/// Verdict — one per evaluated proposal.
///
/// PDA seeds: ["verdict", community_pubkey, proposal_hash]
///
/// Layout: [disc: u8 | version: u8 | data...]
/// Total: 2 + 120 = 122 bytes
#[repr(C)]
pub struct Verdict {
    pub bump: u8,
    pub verdict_type: u8,
    pub community: [u8; 32],
    pub proposal_hash: [u8; 32],
    pub q_score: u16,
    pub fidelity: u16,
    pub phi: u16,
    pub verify: u16,
    pub culture: u16,
    pub burn: u16,
    pub sovereignty: u16,
    pub dog_count: u8,
    pub timestamp: i64,
    pub executed: u8,
}

const _: () = assert!(core::mem::size_of::<Verdict>() == 104);

pub const VERDICT_DISC: u8 = 1;
pub const VERDICT_VERSION: u8 = 1;
pub const VERDICT_LEN: usize = 2 + 104;
pub const VERDICT_SEED: &[u8] = b"verdict";

impl Verdict {
    pub fn from_bytes(data: &[u8]) -> Result<&Self, ProgramError> {
        if data.len() < VERDICT_LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        if data[0] != VERDICT_DISC {
            return Err(ProgramError::InvalidAccountData);
        }
        Ok(unsafe { &*(data[2..].as_ptr() as *const Self) })
    }

    pub fn from_bytes_mut(data: &mut [u8]) -> Result<&mut Self, ProgramError> {
        if data.len() < VERDICT_LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        if data[0] != VERDICT_DISC {
            return Err(ProgramError::InvalidAccountData);
        }
        Ok(unsafe { &mut *(data[2..].as_mut_ptr() as *mut Self) })
    }

    pub fn is_executed(&self) -> bool {
        self.executed != 0
    }

    pub fn verdict_type(&self) -> Result<VerdictType, ProgramError> {
        VerdictType::try_from(self.verdict_type)
    }
}
