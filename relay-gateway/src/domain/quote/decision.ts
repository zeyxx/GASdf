/**
 * Pure domain types & decision functions for live dynamic quoting.
 * Zero-I/O Core.
 */

export const ASDF_MINT = '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump';
export const DEFAULT_QUOTE_TTL_SECONDS = 45; // 45s guarantee window
export const MAX_ALLOWED_PRICE_IMPACT_PCT = 2.5; // Max 2.5% price impact allowed

export interface LiveQuoteRequest {
  inputMint: string;
  inputSymbol: string;
  inputDecimals: number;
  targetAsdfBaseUnits: bigint;
  slippageBps?: number;
}

export interface JupiterRawQuote {
  inAmount: string; // Base units string
  outAmount: string; // Base units string
  priceImpactPct: string;
  routePlan?: unknown[];
}

export interface LiveQuoteDecision {
  status: 'valid' | 'price_impact_too_high' | 'route_missing' | 'expired';
  inputMint: string;
  inputSymbol: string;
  inputAmountBaseUnits: string;
  inputAmountFormatted: number;
  targetAsdfBaseUnits: string;
  targetAsdfFormatted: number;
  priceImpactPct: number;
  slippageBps: number;
  quotedAt: number; // epoch ms
  validUntil: number; // epoch ms
  ttlSeconds: number;
  reason?: string;
}

export function decideLiveQuote(
  req: LiveQuoteRequest,
  jupQuote: JupiterRawQuote | null,
  nowMs: number,
  ttlSeconds: number = DEFAULT_QUOTE_TTL_SECONDS,
): LiveQuoteDecision {
  const slippageBps = req.slippageBps ?? 50;

  if (!jupQuote) {
    return {
      status: 'route_missing',
      inputMint: req.inputMint,
      inputSymbol: req.inputSymbol,
      inputAmountBaseUnits: '0',
      inputAmountFormatted: 0,
      targetAsdfBaseUnits: req.targetAsdfBaseUnits.toString(),
      targetAsdfFormatted: Number(req.targetAsdfBaseUnits) / 1e6,
      priceImpactPct: 0,
      slippageBps,
      quotedAt: nowMs,
      validUntil: nowMs,
      ttlSeconds: 0,
      reason: 'No swap route found for this pair/amount on Jupiter',
    };
  }

  const priceImpact = Math.abs(parseFloat(jupQuote.priceImpactPct || '0'));
  const inputBaseUnits = BigInt(jupQuote.inAmount);
  const inputFormatted = Number(inputBaseUnits) / 10 ** req.inputDecimals;
  const targetFormatted = Number(req.targetAsdfBaseUnits) / 1e6;

  if (priceImpact > MAX_ALLOWED_PRICE_IMPACT_PCT) {
    return {
      status: 'price_impact_too_high',
      inputMint: req.inputMint,
      inputSymbol: req.inputSymbol,
      inputAmountBaseUnits: inputBaseUnits.toString(),
      inputAmountFormatted: inputFormatted,
      targetAsdfBaseUnits: req.targetAsdfBaseUnits.toString(),
      targetAsdfFormatted: targetFormatted,
      priceImpactPct: priceImpact,
      slippageBps,
      quotedAt: nowMs,
      validUntil: nowMs,
      ttlSeconds: 0,
      reason: `Price impact (${priceImpact.toFixed(2)}%) exceeds safe threshold (${MAX_ALLOWED_PRICE_IMPACT_PCT}%)`,
    };
  }

  return {
    status: 'valid',
    inputMint: req.inputMint,
    inputSymbol: req.inputSymbol,
    inputAmountBaseUnits: inputBaseUnits.toString(),
    inputAmountFormatted: inputFormatted,
    targetAsdfBaseUnits: req.targetAsdfBaseUnits.toString(),
    targetAsdfFormatted: targetFormatted,
    priceImpactPct: priceImpact,
    slippageBps,
    quotedAt: nowMs,
    validUntil: nowMs + ttlSeconds * 1000,
    ttlSeconds,
  };
}

export function isQuoteExpired(quote: LiveQuoteDecision, nowMs: number): boolean {
  return nowMs >= quote.validUntil;
}
