use pinocchio::program_error::ProgramError;

// Custom error codes start at 6000 to avoid collision with system errors
pub const ERR_COMMUNITY_ALREADY_INITIALIZED: u32 = 6000;
pub const ERR_COMMUNITY_PAUSED: u32 = 6001;
pub const ERR_COMMUNITY_NOT_PAUSED: u32 = 6002;
pub const ERR_INVALID_AGENT: u32 = 6003;
pub const ERR_INVALID_GUARDIAN: u32 = 6004;
pub const ERR_VERDICT_BELOW_THRESHOLD: u32 = 6005;
pub const ERR_VERDICT_EXPIRED: u32 = 6006;
pub const ERR_TIMELOCK_NOT_ELAPSED: u32 = 6007;
pub const ERR_INVALID_VERDICT_FOR_ACTION: u32 = 6008;
pub const ERR_INVALID_ACTION_TYPE: u32 = 6009;
pub const ERR_INSUFFICIENT_FUNDS: u32 = 6010;

#[inline(always)]
pub fn governance_error(code: u32) -> ProgramError {
    ProgramError::Custom(code)
}
