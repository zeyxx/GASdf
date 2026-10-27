/**
 * Atomic Transaction Domain Rules.
 * Pure logic for combining Jupiter Swap + SPL BurnChecked + Kora Gasless Fee Payer.
 * Zero-I/O Core.
 */

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
