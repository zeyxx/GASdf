/**
 * Atomic Transaction Domain Rules.
 * Pure logic for combining Jupiter Swap + SPL BurnChecked + Kora Gasless Fee Payer.
 * Zero-I/O Core.
 */

export const SPL_TOKEN_ATA_RENT_LAMPORTS = 1_488_440n; // 165 bytes rent-exempt floor
export const TOKEN_2022_ATA_RENT_LAMPORTS = 1_828_800n; // 232 bytes rent-exempt floor

export interface AccountLifespanPolicy {
  preserveAsdfAta: boolean; // Never close target ASDF ATA (prevents NonZeroBalance abort)
  allowEphemeralWsolCleanup: boolean; // Clean up temporary WSOL account
  chargeAtaCreationRent: boolean; // Charge rent if ATA does not exist
  requiredRentLamports: bigint;
}

export function evaluateAccountLifespanPolicy(params: {
  isInputNativeSol: boolean;
  userAsdfAtaExists: boolean;
  preserveAsdfAta?: boolean;
}): AccountLifespanPolicy {
  const preserveAsdfAta = params.preserveAsdfAta ?? true;
  const chargeAtaCreationRent = !params.userAsdfAtaExists;
  const requiredRentLamports = chargeAtaCreationRent ? SPL_TOKEN_ATA_RENT_LAMPORTS : 0n;

  return {
    preserveAsdfAta,
    allowEphemeralWsolCleanup: params.isInputNativeSol,
    chargeAtaCreationRent,
    requiredRentLamports,
  };
}

export interface AtomicTxSpec {
  userWallet: string;
  userAta: string;
  asdfMint: string;
  inputMint: string;
  inputAmountBaseUnits: bigint;
  burnAsdfBaseUnits: bigint;
  feePayer: string;
  recentBlockhash: string;
}

export interface PreparedAtomicPlan {
  userWallet: string;
  burnAmountBaseUnits: string;
  feePayer: string;
  valid: boolean;
  reason?: string;
}

export function validateAtomicPlan(spec: AtomicTxSpec): PreparedAtomicPlan {
  if (!spec.userWallet || !spec.feePayer) {
    return {
      userWallet: spec.userWallet,
      burnAmountBaseUnits: spec.burnAsdfBaseUnits.toString(),
      feePayer: spec.feePayer,
      valid: false,
      reason: 'Missing userWallet or feePayer',
    };
  }

  if (spec.burnAsdfBaseUnits <= 0n) {
    return {
      userWallet: spec.userWallet,
      burnAmountBaseUnits: spec.burnAsdfBaseUnits.toString(),
      feePayer: spec.feePayer,
      valid: false,
      reason: 'burnAsdfBaseUnits must be strictly positive',
    };
  }

  return {
    userWallet: spec.userWallet,
    burnAmountBaseUnits: spec.burnAsdfBaseUnits.toString(),
    feePayer: spec.feePayer,
    valid: true,
  };
}
