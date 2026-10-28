export { B as BurnStats, D as DualBurnInfo, G as GASdf, a as GASdfConfig, h as GASdfError, f as HealthStatus, H as HolderTierInfo, K as KScoreTier, N as NetworkError, P as PaymentToken, Q as Quote, i as QuoteExpiredError, j as QuoteNotFoundError, d as QuotePaymentToken, b as QuoteRequest, l as RateLimitError, R as RetryConfig, S as SubmitRequest, c as SubmitResult, g as SupportedTransaction, T as TokenScore, k as TransactionError, e as TreasuryInfo, V as ValidationError } from './errors-CEsZX8T7.js';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';

declare const GASDF_PROGRAM_ID: PublicKey;
interface RelayWithVaultParams {
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
declare function createRelayWithVaultInstruction(params: RelayWithVaultParams, programId?: PublicKey): TransactionInstruction;

/**
 * Resilient fetch utility with timeout, retry, and correlation IDs
 * Mirrors the patterns from @solana/keychain-core for unified resilience
 */

/**
 * Generate a correlation ID for request tracing
 */
declare function generateCorrelationId(): string;

/**
 * Types for the GASdf Client SDK.
 */
type SupportedTokenSymbol = 'USDC' | 'SOL' | 'USDT';
interface GasdfClientOptions {
    gatewayUrl: string;
    timeoutMs?: number;
}
interface LiveQuote {
    status: 'valid' | 'price_impact_too_high' | 'route_missing' | 'expired';
    inputMint: string;
    inputSymbol: string;
    inputAmountFormatted: number;
    inputAmountBaseUnits: string;
    targetAsdfFormatted: number;
    targetAsdfBaseUnits: string;
    priceImpactPct: number;
    quotedAt: number;
    validUntil: number;
    ttlSeconds: number;
    reason?: string;
}
interface SubscriptionSession {
    sessionId: string;
    appId: string;
    planId: string;
    buyerPubkey: string;
    inputTokenMint: string | null;
    status: 'open' | 'quoted' | 'pending' | 'settled' | 'expired';
    createdAt: number;
    expiresAt: number;
}
interface PreparedAtomicTx {
    sessionId: string;
    planId: string;
    buyerPubkey: string;
    feePayer: string;
    inputToken: string;
    inputAmountFormatted: number;
    burnAsdfFormatted: number;
    base64WireTx: string;
    recentBlockhash: string;
    validUntil: number;
    ttlSeconds: number;
}
interface SettlementReceipt {
    status: 'settled';
    sessionId: string;
    txSignature: string;
    explorerUrl: string;
}
interface WalletStandardSigner {
    signTransaction: (input: {
        account: {
            address: string;
        };
        transaction: Uint8Array;
        chain?: string;
    }) => Promise<[{
        signedTransaction: Uint8Array;
    }] | {
        signedTransaction: Uint8Array;
    }[]>;
}

/**
 * Isomorphic GASdf Client SDK.
 * Handles live quotes, atomic preparation, wallet-standard signing, and relay submission.
 */

declare class GasdfClient {
    private gatewayUrl;
    private timeoutMs;
    constructor(opts: GasdfClientOptions);
    private fetchJson;
    /**
     * Fetches a live dynamic quote with TTL for a subscription plan.
     */
    getLiveQuote(token?: SupportedTokenSymbol, planId?: string, appId?: string): Promise<LiveQuote>;
    /**
     * Starts a subscription session.
     */
    createSession(appId: string, planId: string, buyerPubkey: string): Promise<SubscriptionSession>;
    /**
     * Prepares the atomic VersionedTransaction (Base64) ready for user signature.
     */
    prepareAtomicSubscription(sessionId: string, inputToken: SupportedTokenSymbol): Promise<PreparedAtomicTx>;
    /**
     * Submits the user-signed transaction to GASdf (Kora co-signs and broadcasts).
     */
    submitAtomicSubscription(sessionId: string, base64SignedTx: string): Promise<SettlementReceipt>;
    /**
     * Convenience 1-Click Pipeline:
     * 1. Creates session
     * 2. Prepares atomic transaction
     * 3. Prompts user wallet to sign
     * 4. Relays co-signed transaction to Solana via Kora
     */
    executeOneClickSubscription(params: {
        appId: string;
        planId: string;
        buyerPubkey: string;
        inputToken: SupportedTokenSymbol;
        signer: WalletStandardSigner;
        onStage?: (stage: 'quoting' | 'preparing' | 'signing' | 'relaying') => void;
    }): Promise<SettlementReceipt>;
}

export { GASDF_PROGRAM_ID, GasdfClient, type GasdfClientOptions, type LiveQuote, type PreparedAtomicTx, type RelayWithVaultParams, type SettlementReceipt, type SubscriptionSession, type SupportedTokenSymbol, type WalletStandardSigner, createRelayWithVaultInstruction, generateCorrelationId };
