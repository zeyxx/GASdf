/**
 * GASdf SDK TypeScript Definitions
 */

export interface Quote {
  quoteId: string;
  feePayer: string;
  blockhash: string;
  lastValidBlockHeight: number;
  feeAmountLamports: number;
  feeAmountFormatted: string;
  paymentToken: string;
  kScore: {
    score: number;
    tier: 'TRUSTED' | 'STANDARD' | 'RISKY' | 'UNKNOWN';
    feeMultiplier: number;
  };
  expiresAt: string;
  feeInstruction?: {
    source: string;
    destination: string;
    authority: string;
    amount: string;
  };
}

export interface SubmitResult {
  success: boolean;
  signature: string;
  explorerUrl: string;
}

export interface Token {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUri?: string;
}

export interface Stats {
  totalBurned: number;
  totalTransactions: number;
  burnedFormatted: string;
  treasury: {
    balance: number;
    balanceFormatted: string;
    model: string;
    burnRatio: number;
    treasuryRatio: number;
  };
}

export interface BurnProof {
  burnSignature: string;
  swapSignature: string;
  amountBurned: number;
  amountFormatted: string;
  solAmount: number;
  solFormatted: string;
  treasuryAmount: number;
  treasuryFormatted: string;
  method: 'pumpswap' | 'jupiter';
  timestamp: number;
  network: string;
  explorerUrl: string;
  age: string;
}

export interface BurnProofs {
  burns: BurnProof[];
  totalBurns: number;
  verification: {
    message: string;
    howToVerify: string;
  };
}

export interface Health {
  status: 'ok' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  network: string;
  checks: {
    redis: { status: string };
    rpc: { status: string; slot?: number };
    feePayer: { status: string };
  };
}

export interface GASdfOptions {
  baseUrl?: string;
  timeout?: number;
}

export class GASdfError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number);
}

export class GASdf {
  constructor(options?: GASdfOptions);

  quote(paymentToken: string, userPubkey: string, options?: {
    priorityLevel?: number;
  }): Promise<Quote>;

  submit(quoteId: string, signedTransaction: string): Promise<SubmitResult>;

  tokens(): Promise<Token[]>;

  stats(): Promise<Stats>;

  burnProofs(limit?: number): Promise<BurnProofs>;

  verifyBurn(signature: string): Promise<{ verified: boolean; proof: BurnProof }>;

  health(): Promise<Health>;
}

export function createGaslessTransaction(
  connection: any,
  quote: Quote,
  instructions: any[]
): any;
