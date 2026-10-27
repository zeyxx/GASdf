/**
 * Jupiter Quote Client Adapter.
 * Uses Jupiter v1 API (lite-api.jup.ag).
 */

import {
  ASDF_MINT,
  decideLiveQuote,
  type LiveQuoteDecision,
  type LiveQuoteRequest,
  type JupiterRawQuote,
  DEFAULT_QUOTE_TTL_SECONDS,
} from '../../domain/quote/decision.js';

export class JupiterQuoteAdapter {
  private baseUrl: string;

  constructor(baseUrl: string = 'https://lite-api.jup.ag/swap/v1') {
    this.baseUrl = baseUrl;
  }

  /**
   * Fetches the input amount required to obtain targetAsdfBaseUnits of $ASDFASDFA.
   * Leverages spot estimation and quote confirmation.
   */
  async getLiveQuoteForAsdf(
    req: LiveQuoteRequest,
    nowMs: number = Date.now(),
    ttlSeconds: number = DEFAULT_QUOTE_TTL_SECONDS,
  ): Promise<LiveQuoteDecision> {
    try {
      // 1. Get spot price estimate by querying a reference input
      const refInputBaseUnits = 5 * 10 ** req.inputDecimals; // e.g. 5 USDC or 0.05 SOL
      const probeUrl = `${this.baseUrl}/quote?inputMint=${encodeURIComponent(
        req.inputMint,
      )}&outputMint=${encodeURIComponent(ASDF_MINT)}&amount=${refInputBaseUnits}&slippageBps=${
        req.slippageBps ?? 50
      }`;

      const probeRes = await fetch(probeUrl);
      if (!probeRes.ok) {
        return decideLiveQuote(req, null, nowMs, ttlSeconds);
      }

      const probeData = (await probeRes.json()) as {
        inAmount: string;
        outAmount: string;
        priceImpactPct: string;
      };

      const outBaseUnits = BigInt(probeData.outAmount);
      if (outBaseUnits <= 0n) {
        return decideLiveQuote(req, null, nowMs, ttlSeconds);
      }

      // 2. Extrapolate exact required input amount
      // requiredIn = (targetOut * probeIn) / probeOut
      const requiredInBaseUnits =
        (req.targetAsdfBaseUnits * BigInt(probeData.inAmount)) / outBaseUnits;

      // 3. Confirm exact quote with calculated required inAmount
      const exactUrl = `${this.baseUrl}/quote?inputMint=${encodeURIComponent(
        req.inputMint,
      )}&outputMint=${encodeURIComponent(ASDF_MINT)}&amount=${requiredInBaseUnits}&slippageBps=${
        req.slippageBps ?? 50
      }`;

      const exactRes = await fetch(exactUrl);
      if (!exactRes.ok) {
        // Fallback to probe ratio if second fetch is throttled
        const fallbackQuote: JupiterRawQuote = {
          inAmount: requiredInBaseUnits.toString(),
          outAmount: req.targetAsdfBaseUnits.toString(),
          priceImpactPct: probeData.priceImpactPct,
        };
        return decideLiveQuote(req, fallbackQuote, nowMs, ttlSeconds);
      }

      const exactData = (await exactRes.json()) as JupiterRawQuote;
      return decideLiveQuote(req, exactData, nowMs, ttlSeconds);
    } catch {
      return decideLiveQuote(req, null, nowMs, ttlSeconds);
    }
  }
}
