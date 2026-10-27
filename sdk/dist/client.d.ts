/**
 * Isomorphic GASdf Client SDK.
 * Handles live quotes, atomic preparation, wallet-standard signing, and relay submission.
 */
import type { GasdfClientOptions, LiveQuote, PreparedAtomicTx, SettlementReceipt, SubscriptionSession, SupportedTokenSymbol, WalletStandardSigner } from './types.js';
export declare class GasdfClient {
    private gatewayUrl;
    private timeoutMs;
    constructor(opts: GasdfClientOptions);
    private fetchJson;
    /**
     * Fetches a live dynamic quote with TTL for a subscription plan.
     */
    getLiveQuote(token?: SupportedTokenSymbol, planId?: string): Promise<LiveQuote>;
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
