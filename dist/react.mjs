import { createContext, useMemo, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import { jsx } from 'react/jsx-runtime';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';

// src/react/context.tsx

// src/errors.ts
var GASdfError = class extends Error {
  constructor(message, code, statusCode) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.name = "GASdfError";
  }
};
var QuoteExpiredError = class extends GASdfError {
  constructor(quoteId) {
    super(`Quote ${quoteId} has expired`, "QUOTE_EXPIRED", 400);
    this.name = "QuoteExpiredError";
  }
};
var QuoteNotFoundError = class extends GASdfError {
  constructor(quoteId) {
    super(`Quote ${quoteId} not found`, "QUOTE_NOT_FOUND", 404);
    this.name = "QuoteNotFoundError";
  }
};
var ValidationError = class extends GASdfError {
  constructor(message, errors = []) {
    super(message, "VALIDATION_ERROR", 400);
    this.errors = errors;
    this.name = "ValidationError";
  }
};
var RateLimitError = class extends GASdfError {
  constructor(retryAfter) {
    super("Rate limit exceeded", "RATE_LIMIT", 429);
    this.retryAfter = retryAfter;
    this.name = "RateLimitError";
  }
};
var NetworkError = class extends GASdfError {
  constructor(message) {
    super(message, "NETWORK_ERROR");
    this.name = "NetworkError";
  }
};
function parseApiError(status, body) {
  const data = typeof body === "string" ? { error: body } : body;
  const message = data.error || "Unknown error";
  switch (status) {
    case 400:
      if (message.includes("expired")) {
        return new QuoteExpiredError(data.quoteId || "unknown");
      }
      return new ValidationError(message, data.errors);
    case 404:
      if (message.includes("quote") || message.includes("Quote")) {
        return new QuoteNotFoundError(data.quoteId || "unknown");
      }
      return new GASdfError(message, "NOT_FOUND", 404);
    case 429:
      return new RateLimitError();
    case 500:
    case 502:
    case 503:
      return new GASdfError(message, "SERVER_ERROR", status);
    default:
      return new GASdfError(message, "UNKNOWN_ERROR", status);
  }
}

// src/fetch.ts
var DEFAULT_TIMEOUT_MS = 3e4;
var DEFAULT_RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 100,
  maxDelayMs: 5e3,
  // 429 is NOT included - let client handle rate limiting via RateLimitError
  // Only retry on transient server errors
  retryableStatusCodes: [500, 502, 503, 504]
};
function generateCorrelationId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `gasdf_${timestamp}_${random}`;
}
function calculateBackoff(attempt, config) {
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * config.baseDelayMs;
  return Math.min(exponentialDelay + jitter, config.maxDelayMs);
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function fetchWithTimeout(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryConfig = {
    ...DEFAULT_RETRY_CONFIG,
    ...options.retry
  };
  const correlationId = options.correlationId ?? generateCorrelationId();
  const headersInit = options.headers instanceof Headers ? options.headers : options.headers || {};
  const headers = {
    ...headersInit,
    "x-correlation-id": correlationId
  };
  let lastResponse = null;
  for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (retryConfig.retryableStatusCodes.includes(response.status) && attempt < retryConfig.maxRetries) {
        lastResponse = response;
        await sleep(calculateBackoff(attempt, retryConfig));
        continue;
      }
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error) {
        if (error.name === "AbortError") {
          throw new NetworkError(`Request timeout after ${timeoutMs}ms`);
        }
        throw new NetworkError(error.message);
      }
      throw new NetworkError("Unknown network error");
    }
  }
  if (lastResponse) {
    throw new GASdfError(
      `Request failed with status ${lastResponse.status} after ${retryConfig.maxRetries + 1} attempts`,
      "MAX_RETRIES_EXCEEDED",
      lastResponse.status
    );
  }
  throw new NetworkError("Network error");
}

// src/client.ts
var DEFAULT_ENDPOINT = "https://asdfasdfa.tech";
var DEFAULT_TIMEOUT = 3e4;
var GASdf = class {
  constructor(config = {}) {
    this.endpoint = (config.endpoint || DEFAULT_ENDPOINT).replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.timeout = config.timeout || DEFAULT_TIMEOUT;
    this.retryConfig = config.retry;
  }
  /**
   * Get a fee quote for a gasless transaction
   *
   * @param request - Quote request parameters
   * @returns Quote with fee payer and amount
   */
  async getQuote(request) {
    const userPubkey = this.toBase58(request.userPubkey);
    const paymentToken = this.toBase58(request.paymentToken);
    const response = await this.fetch("/quote", {
      method: "POST",
      body: JSON.stringify({
        userPubkey,
        paymentToken,
        estimatedComputeUnits: request.estimatedComputeUnits
      })
    });
    return response;
  }
  /**
   * Submit a signed transaction through GASdf
   *
   * The transaction must:
   * - Have feePayer set to the quote's feePayer
   * - Be signed by the user
   * - NOT be signed by the fee payer (GASdf will co-sign)
   *
   * @param transaction - User-signed transaction
   * @param quoteId - Quote ID from getQuote
   * @returns Transaction signature
   */
  async submit(transaction, quoteId) {
    const serialized = this.serializeTransaction(transaction);
    const userPubkey = this.extractUserPubkey(transaction);
    const response = await this.fetch("/submit", {
      method: "POST",
      body: JSON.stringify({
        transaction: serialized,
        quoteId,
        userPubkey
      })
    });
    return response;
  }
  /**
   * Convenience method: get quote and prepare transaction in one call
   *
   * @param transaction - Transaction to wrap (feePayer will be set)
   * @param paymentToken - Token mint to pay fees with
   * @returns Quote and modified transaction
   */
  async wrap(transaction, paymentToken) {
    const userPubkey = transaction.signatures[0]?.publicKey || transaction.feePayer;
    if (!userPubkey) {
      throw new GASdfError(
        "Transaction must have a feePayer or signature",
        "INVALID_TRANSACTION"
      );
    }
    const quote = await this.getQuote({
      userPubkey,
      paymentToken: this.toBase58(paymentToken)
    });
    transaction.feePayer = new PublicKey(quote.feePayer);
    return { quote, transaction };
  }
  /**
   * Get list of supported payment tokens
   */
  async getTokens() {
    const response = await this.fetch("/tokens");
    return response.tokens;
  }
  /**
   * Get K-score for a token
   *
   * @param mint - Token mint address
   */
  async getTokenScore(mint) {
    const mintStr = this.toBase58(mint);
    return this.fetch(`/tokens/${mintStr}/score`);
  }
  /**
   * Get API health status
   */
  async health() {
    return this.fetch("/health");
  }
  /**
   * Get burn statistics
   */
  async stats() {
    return this.fetch("/stats");
  }
  /**
   * Check if a quote is still valid
   */
  isQuoteValid(quote) {
    return Date.now() < quote.expiresAt;
  }
  /**
   * Get fee payer public key from a quote
   */
  getFeePayerPubkey(quote) {
    return new PublicKey(quote.feePayer);
  }
  // ─────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────
  async fetch(path, init) {
    const url = `${this.endpoint}${path}`;
    const correlationId = generateCorrelationId();
    const headers = {
      "Content-Type": "application/json"
    };
    if (this.apiKey) {
      headers["x-api-key"] = this.apiKey;
    }
    const response = await fetchWithTimeout(url, {
      ...init,
      headers: { ...headers, ...init?.headers },
      timeoutMs: this.timeout,
      retry: this.retryConfig,
      correlationId
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw parseApiError(response.status, data);
    }
    return data;
  }
  toBase58(value) {
    if (typeof value === "string") {
      return value;
    }
    return value.toBase58();
  }
  serializeTransaction(transaction) {
    if (transaction instanceof VersionedTransaction) {
      return Buffer.from(transaction.serialize()).toString("base64");
    }
    return transaction.serialize({ requireAllSignatures: false }).toString("base64");
  }
  extractUserPubkey(transaction) {
    if (transaction instanceof VersionedTransaction) {
      const keys = transaction.message.staticAccountKeys;
      const numSigners = transaction.message.header.numRequiredSignatures;
      const feePayer2 = keys[0].toBase58();
      for (let i = 1; i < numSigners && i < keys.length; i++) {
        const sig = transaction.signatures[i];
        if (sig && sig.length === 64 && !sig.every((b) => b === 0)) {
          return keys[i].toBase58();
        }
      }
      return feePayer2;
    }
    const feePayer = transaction.feePayer?.toBase58();
    const signatures = transaction.signatures.filter(
      (sig) => sig.signature !== null && sig.publicKey.toBase58() !== feePayer
    );
    if (signatures.length > 0) {
      return signatures[0].publicKey.toBase58();
    }
    if (transaction.signatures.length > 0 && transaction.signatures[0].signature !== null) {
      return transaction.signatures[0].publicKey.toBase58();
    }
    throw new GASdfError(
      "Transaction must be signed by user",
      "UNSIGNED_TRANSACTION"
    );
  }
};
var GASdfContext = createContext(null);
function GASdfProvider({
  children,
  endpoint,
  apiKey,
  timeout
}) {
  const config = useMemo(
    () => ({ endpoint, apiKey, timeout }),
    [endpoint, apiKey, timeout]
  );
  const client = useMemo(() => new GASdf(config), [config]);
  const value = useMemo(() => ({ client, config }), [client, config]);
  return /* @__PURE__ */ jsx(GASdfContext.Provider, { value, children });
}
function useGASdf() {
  const context = useContext(GASdfContext);
  if (!context) {
    throw new Error("useGASdf must be used within a GASdfProvider");
  }
  return context;
}
function useGaslessTransaction(options) {
  const { client } = useGASdf();
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const [status, setStatus] = useState("idle");
  const [quote, setQuote] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const reset = useCallback(() => {
    setStatus("idle");
    setQuote(null);
    setResult(null);
    setError(null);
  }, []);
  const execute = useCallback(
    async (transaction) => {
      if (!publicKey) {
        const err = new Error("Wallet not connected");
        setError(err);
        setStatus("error");
        options.onError?.(err);
        return null;
      }
      if (!signTransaction) {
        const err = new Error("Wallet does not support signing");
        setError(err);
        setStatus("error");
        options.onError?.(err);
        return null;
      }
      try {
        setError(null);
        setResult(null);
        setStatus("getting-quote");
        const newQuote = await client.getQuote({
          userPubkey: publicKey,
          paymentToken: options.paymentToken
        });
        setQuote(newQuote);
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        transaction.feePayer = new PublicKey(newQuote.feePayer);
        transaction.recentBlockhash = blockhash;
        transaction.lastValidBlockHeight = lastValidBlockHeight;
        setStatus("awaiting-signature");
        const signed = await signTransaction(transaction);
        setStatus("submitting");
        const submitResult = await client.submit(signed, newQuote.quoteId);
        setStatus("confirming");
        setResult(submitResult);
        setStatus("success");
        options.onSuccess?.(submitResult);
        return submitResult;
      } catch (err) {
        const error2 = err instanceof Error ? err : new Error(String(err));
        setError(error2);
        setStatus("error");
        options.onError?.(error2);
        return null;
      }
    },
    [client, connection, publicKey, signTransaction, options]
  );
  return {
    execute,
    status,
    quote,
    result,
    error,
    isLoading: !["idle", "success", "error"].includes(status),
    reset
  };
}
function useTokens() {
  const { client } = useGASdf();
  const [tokens, setTokens] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await client.getTokens();
      setTokens(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, [client]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return { tokens, isLoading, error, refresh };
}
function useTokenScore(mint) {
  const { client } = useGASdf();
  const [score, setScore] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!mint) {
      setScore(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    client.getTokenScore(mint).then(setScore).catch((err) => setError(err instanceof Error ? err : new Error(String(err)))).finally(() => setIsLoading(false));
  }, [client, mint]);
  return { score, isLoading, error };
}
function useQuote(options) {
  const { client } = useGASdf();
  const { publicKey } = useWallet();
  const [quote, setQuote] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isValid, setIsValid] = useState(false);
  const refreshTimerRef = useRef(null);
  const {
    paymentToken,
    autoRefresh = true,
    refreshBuffer = 10
  } = options;
  const refresh = useCallback(async () => {
    if (!publicKey || !paymentToken) {
      setQuote(null);
      setIsValid(false);
      return null;
    }
    setIsLoading(true);
    setError(null);
    try {
      const newQuote = await client.getQuote({
        userPubkey: publicKey,
        paymentToken
      });
      setQuote(newQuote);
      setIsValid(true);
      if (autoRefresh && refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
      if (autoRefresh) {
        const refreshIn = Math.max(
          (newQuote.ttl - refreshBuffer) * 1e3,
          5e3
          // Min 5s
        );
        refreshTimerRef.current = setTimeout(() => {
          refresh();
        }, refreshIn);
      }
      return newQuote;
    } catch (err) {
      const error2 = err instanceof Error ? err : new Error(String(err));
      setError(error2);
      setIsValid(false);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [client, publicKey, paymentToken, autoRefresh, refreshBuffer]);
  useEffect(() => {
    if (publicKey && paymentToken) {
      refresh();
    } else {
      setQuote(null);
      setIsValid(false);
    }
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, [publicKey, paymentToken]);
  useEffect(() => {
    if (!quote) return;
    const checkValidity = () => {
      setIsValid(client.isQuoteValid(quote));
    };
    const interval = setInterval(checkValidity, 1e3);
    return () => clearInterval(interval);
  }, [quote, client]);
  return {
    quote,
    isLoading,
    error,
    isValid,
    refresh
  };
}

export { GASdfError, GASdfProvider, QuoteExpiredError, ValidationError, useGASdf, useGaslessTransaction, useQuote, useTokenScore, useTokens };
