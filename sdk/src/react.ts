import type { SupportedTokenSymbol, LiveQuote } from './types.js';

export interface GasdfPayButtonProps {
  appId?: string; // default "trenchscanner"
  planId?: string; // default "pro-monthly"
  buyerPubkey: string;
  gatewayUrl?: string; // default "https://relay.gasdf.org" or container IP
  token?: SupportedTokenSymbol; // default "USDC"
  onSuccess?: (txSignature: string) => void;
  onError?: (error: Error) => void;
  className?: string;
  children?: any;
}

/**
 * State of the 1-Click Payflow.
 */
export type PayflowState =
  | { status: 'idle' }
  | { status: 'quoting'; quote?: LiveQuote }
  | { status: 'ready'; quote: LiveQuote }
  | { status: 'signing'; quote: LiveQuote }
  | { status: 'relaying'; quote: LiveQuote }
  | { status: 'settled'; txSignature: string }
  | { status: 'error'; message: string };
