import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

export const GASDF_PROGRAM_ID = new PublicKey('GASdf11111111111111111111111111111111111111');

export interface RelayWithVaultParams {
  userTokenAccount: PublicKey;
  userAuthority: PublicKey;
  vaultTokenAccount: PublicKey;
  vaultSolAccount: PublicKey;
  operatorSolAccount: PublicKey;
  tokenAmount: bigint;
  solReimbursement: bigint;
  vaultBump: number;
}

/**
 * Creates a RelayWithVault instruction for the GASdf Pinocchio program.
 */
export function createRelayWithVaultInstruction(
  params: RelayWithVaultParams,
  programId: PublicKey = GASDF_PROGRAM_ID
): TransactionInstruction {
  const keys = [
    { pubkey: params.userTokenAccount, isSigner: false, isWritable: true },
    { pubkey: params.userAuthority, isSigner: true, isWritable: false },
    { pubkey: params.vaultTokenAccount, isSigner: false, isWritable: true },
    { pubkey: params.vaultSolAccount, isSigner: false, isWritable: true },
    { pubkey: params.operatorSolAccount, isSigner: true, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const data = Buffer.alloc(1 + 8 + 8 + 1);
  data.writeUInt8(1, 0); // Instruction Type: 1 (RelayWithVault)
  data.writeBigUInt64LE(params.tokenAmount, 1);
  data.writeBigUInt64LE(params.solReimbursement, 9);
  data.writeUInt8(params.vaultBump, 17);

  return new TransactionInstruction({
    keys,
    programId,
    data,
  });
}
