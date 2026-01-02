import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PublicKey, Transaction, SystemProgram, Keypair } from '@solana/web3.js';
import { GASdf } from './client';
import { GASdfError, NetworkError, ValidationError, RateLimitError } from './errors';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('GASdf Client', () => {
  let client: GASdf;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new GASdf({ endpoint: 'https://test.api' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should use default endpoint if not provided', () => {
      const defaultClient = new GASdf();
      expect((defaultClient as any).endpoint).toBe('https://asdfasdfa.tech');
    });

    it('should strip trailing slash from endpoint', () => {
      const client = new GASdf({ endpoint: 'https://test.api/' });
      expect((client as any).endpoint).toBe('https://test.api');
    });

    it('should store API key if provided', () => {
      const client = new GASdf({ apiKey: 'test-key' });
      expect((client as any).apiKey).toBe('test-key');
    });

    it('should use default timeout', () => {
      const client = new GASdf();
      expect((client as any).timeout).toBe(30000);
    });

    it('should accept custom timeout', () => {
      const client = new GASdf({ timeout: 5000 });
      expect((client as any).timeout).toBe(5000);
    });
  });

  describe('getQuote', () => {
    const mockQuote = {
      quoteId: 'test-quote-id',
      feePayer: 'GASdfTestFeePayer1111111111111111111111111',
      feeAmount: '1000000',
      feeFormatted: '1.00 USDC',
      paymentToken: { mint: 'USDC', symbol: 'USDC', decimals: 6 },
      kScore: { score: 100, tier: 'TRUSTED', feeMultiplier: 1.0 },
      expiresAt: Date.now() + 60000,
      ttl: 60,
    };

    it('should get quote with string pubkeys', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockQuote),
      });

      const quote = await client.getQuote({
        userPubkey: 'UserPubkey111111111111111111111111111111111',
        paymentToken: 'USDC111111111111111111111111111111111111111',
      });

      expect(quote.quoteId).toBe('test-quote-id');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.api/quote',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('UserPubkey'),
        }),
      );
    });

    it('should get quote with PublicKey objects', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockQuote),
      });

      const userPubkey = Keypair.generate().publicKey;
      const paymentToken = Keypair.generate().publicKey;

      await client.getQuote({ userPubkey, paymentToken });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.api/quote',
        expect.objectContaining({
          body: expect.stringContaining(userPubkey.toBase58()),
        }),
      );
    });

    it('should include estimatedComputeUnits if provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockQuote),
      });

      await client.getQuote({
        userPubkey: 'test',
        paymentToken: 'test',
        estimatedComputeUnits: 400000,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.api/quote',
        expect.objectContaining({
          body: expect.stringContaining('400000'),
        }),
      );
    });

    it('should include API key header if configured', async () => {
      const clientWithKey = new GASdf({ endpoint: 'https://test.api', apiKey: 'secret' });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockQuote),
      });

      await clientWithKey.getQuote({ userPubkey: 'test', paymentToken: 'test' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': 'secret',
          }),
        }),
      );
    });

    it('should throw ValidationError on 400 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'Invalid input', errors: ['bad'] }),
      });

      await expect(
        client.getQuote({ userPubkey: 'test', paymentToken: 'test' }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('should throw RateLimitError on 429 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: () => Promise.resolve({ error: 'Rate limited' }),
      });

      await expect(
        client.getQuote({ userPubkey: 'test', paymentToken: 'test' }),
      ).rejects.toBeInstanceOf(RateLimitError);
    });

    it('should throw NetworkError on fetch failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      await expect(
        client.getQuote({ userPubkey: 'test', paymentToken: 'test' }),
      ).rejects.toBeInstanceOf(NetworkError);
    });

    it('should throw NetworkError on timeout', async () => {
      const slowClient = new GASdf({ endpoint: 'https://test.api', timeout: 1 });
      mockFetch.mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(resolve, 100)),
      );

      await expect(
        slowClient.getQuote({ userPubkey: 'test', paymentToken: 'test' }),
      ).rejects.toBeInstanceOf(NetworkError);
    });
  });

  describe('submit', () => {
    const mockResult = {
      signature: 'TestSignature123',
      explorerUrl: 'https://solscan.io/tx/TestSignature123',
    };

    it('should submit legacy transaction', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResult),
      });

      const tx = new Transaction();
      const user = Keypair.generate();
      tx.feePayer = user.publicKey;
      tx.recentBlockhash = 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi';
      tx.add(
        SystemProgram.transfer({
          fromPubkey: user.publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: 1000,
        }),
      );
      tx.sign(user);

      const result = await client.submit(tx, 'quote-123');

      expect(result.signature).toBe('TestSignature123');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.api/submit',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('quote-123'),
        }),
      );
    });

    it('should throw GASdfError if transaction not signed', async () => {
      const tx = new Transaction();
      tx.feePayer = Keypair.generate().publicKey;
      tx.recentBlockhash = 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi';

      await expect(client.submit(tx, 'quote-123')).rejects.toThrow(
        'Transaction must be signed by user',
      );
    });
  });

  describe('wrap', () => {
    it('should get quote and set fee payer on transaction', async () => {
      const mockQuote = {
        quoteId: 'wrap-quote',
        feePayer: Keypair.generate().publicKey.toBase58(),
        feeAmount: '1000',
        expiresAt: Date.now() + 60000,
        ttl: 60,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockQuote),
      });

      const tx = new Transaction();
      const user = Keypair.generate();
      tx.feePayer = user.publicKey;
      tx.add(
        SystemProgram.transfer({
          fromPubkey: user.publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: 1000,
        }),
      );

      const { quote, transaction } = await client.wrap(tx, 'USDC_MINT');

      expect(quote.quoteId).toBe('wrap-quote');
      expect(transaction.feePayer?.toBase58()).toBe(mockQuote.feePayer);
    });

    it('should throw if transaction has no feePayer or signature', async () => {
      const tx = new Transaction();

      await expect(client.wrap(tx, 'USDC_MINT')).rejects.toThrow(
        'Transaction must have a feePayer or signature',
      );
    });
  });

  describe('getTokens', () => {
    it('should return list of tokens', async () => {
      const mockTokens = {
        tokens: [
          { mint: 'USDC', symbol: 'USDC', decimals: 6 },
          { mint: 'SOL', symbol: 'SOL', decimals: 9 },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTokens),
      });

      const tokens = await client.getTokens();

      expect(tokens).toHaveLength(2);
      expect(tokens[0].symbol).toBe('USDC');
    });
  });

  describe('getTokenScore', () => {
    it('should return token score', async () => {
      const mockScore = {
        mint: 'USDC',
        score: 100,
        tier: 'TRUSTED',
        feeMultiplier: 1.0,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockScore),
      });

      const score = await client.getTokenScore('USDC');

      expect(score.tier).toBe('TRUSTED');
      expect(score.feeMultiplier).toBe(1.0);
    });

    it('should accept PublicKey', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ mint: 'test', score: 50 }),
      });

      const mint = Keypair.generate().publicKey;
      await client.getTokenScore(mint);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(mint.toBase58()),
        expect.any(Object),
      );
    });
  });

  describe('health', () => {
    it('should return health status', async () => {
      const mockHealth = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        network: 'devnet',
        checks: {
          redis: { status: 'healthy' },
          rpc: { status: 'healthy' },
          feePayer: { status: 'healthy' },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockHealth),
      });

      const health = await client.health();

      expect(health.status).toBe('healthy');
      expect(health.network).toBe('devnet');
    });
  });

  describe('stats', () => {
    it('should return burn stats', async () => {
      const mockStats = {
        totalBurned: 1000000000,
        totalTransactions: 500,
        burnedFormatted: '1,000 $ASDF',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockStats),
      });

      const stats = await client.stats();

      expect(stats.totalBurned).toBe(1000000000);
      expect(stats.totalTransactions).toBe(500);
    });
  });

  describe('isQuoteValid', () => {
    it('should return true for non-expired quote', () => {
      const quote = { expiresAt: Date.now() + 60000 } as any;
      expect(client.isQuoteValid(quote)).toBe(true);
    });

    it('should return false for expired quote', () => {
      const quote = { expiresAt: Date.now() - 1000 } as any;
      expect(client.isQuoteValid(quote)).toBe(false);
    });
  });

  describe('getFeePayerPubkey', () => {
    it('should return PublicKey from quote', () => {
      const feePayer = Keypair.generate().publicKey;
      const quote = { feePayer: feePayer.toBase58() } as any;

      const result = client.getFeePayerPubkey(quote);

      expect(result).toBeInstanceOf(PublicKey);
      expect(result.toBase58()).toBe(feePayer.toBase58());
    });
  });
});
