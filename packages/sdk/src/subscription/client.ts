/**
 * Isomorphic GASdf Client SDK.
 * Handles live quotes, atomic preparation, wallet-standard signing, and relay submission.
 */

import type {
  GasdfClientOptions,
  LiveQuote,
  PreparedAtomicTx,
  SettlementReceipt,
  SubscriptionSession,
  SupportedTokenSymbol,
  WalletStandardSigner,
} from './types.js';

function base64ToUint8Array(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return Uint8Array.from(Buffer.from(base64, 'base64'));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}
export class GasdfClient {
  private gatewayUrl: string;
  private timeoutMs: number;

  constructor(opts: GasdfClientOptions) {
    this.gatewayUrl = opts.gatewayUrl.replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  private async fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.gatewayUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(options?.headers ?? {}),
        },
      });

      if (!res.ok) {
        let errorMsg = `HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) errorMsg = body.error;
        } catch {
          errorMsg = await res.text();
        }
        throw new Error(`GASdf API error (${res.status}): ${errorMsg}`);
      }

      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Fetches a live dynamic quote with TTL for a subscription plan.
   */
  async getLiveQuote(
    token: SupportedTokenSymbol = 'USDC',
    planId: string = 'pro-monthly',
    appId: string = 'trenchscanner',
  ): Promise<LiveQuote> {
    return this.fetchJson<LiveQuote>(
      `/subscription/quote/live?token=${encodeURIComponent(token)}&planId=${encodeURIComponent(planId)}&appId=${encodeURIComponent(appId)}`,
    );
  }

  /**
   * Starts a subscription session.
   */
  async createSession(appId: string, planId: string, buyerPubkey: string): Promise<SubscriptionSession> {
    return this.fetchJson<SubscriptionSession>('/subscription/sessions', {
      method: 'POST',
      body: JSON.stringify({ appId, planId, buyerPubkey }),
    });
  }

  /**
   * Prepares the atomic VersionedTransaction (Base64) ready for user signature.
   */
  async prepareAtomicSubscription(sessionId: string, inputToken: SupportedTokenSymbol): Promise<PreparedAtomicTx> {
    return this.fetchJson<PreparedAtomicTx>(`/subscription/sessions/${encodeURIComponent(sessionId)}/prepare-tx`, {
      method: 'POST',
      body: JSON.stringify({ inputTokenMint: inputToken }),
    });
  }

  /**
   * Submits the user-signed transaction to GASdf (Kora co-signs and broadcasts).
   */
  async submitAtomicSubscription(sessionId: string, base64SignedTx: string): Promise<SettlementReceipt> {
    return this.fetchJson<SettlementReceipt>(`/subscription/sessions/${encodeURIComponent(sessionId)}/submit-tx`, {
      method: 'POST',
      body: JSON.stringify({ base64SignedTx }),
    });
  }

  /**
   * Convenience 1-Click Pipeline:
   * 1. Creates session
   * 2. Prepares atomic transaction
   * 3. Prompts user wallet to sign
   * 4. Relays co-signed transaction to Solana via Kora
   */
  async executeOneClickSubscription(params: {
    appId: string;
    planId: string;
    buyerPubkey: string;
    inputToken: SupportedTokenSymbol;
    signer: WalletStandardSigner;
    onStage?: (stage: 'quoting' | 'preparing' | 'signing' | 'relaying') => void;
  }): Promise<SettlementReceipt> {
    params.onStage?.('preparing');

    // 1. Create Session
    const session = await this.createSession(params.appId, params.planId, params.buyerPubkey);

    // 2. Prepare Atomic Tx
    const prepared = await this.prepareAtomicSubscription(session.sessionId, params.inputToken);

    // 3. User Wallet Signs
    params.onStage?.('signing');
    const wireBytes = base64ToUint8Array(prepared.base64WireTx);
    const signResult = await params.signer.signTransaction({
      account: { address: params.buyerPubkey },
      transaction: wireBytes,
      chain: 'solana:mainnet',
    });

    const signedItem = Array.isArray(signResult) ? signResult[0] : signResult;
    if (!signedItem?.signedTransaction) {
      throw new Error('Wallet did not return a signed transaction');
    }

    const signedWireBase64 = uint8ArrayToBase64(signedItem.signedTransaction);

    // 4. Submit to Kora Relay
    params.onStage?.('relaying');
    return this.submitAtomicSubscription(session.sessionId, signedWireBase64);
  }
}
