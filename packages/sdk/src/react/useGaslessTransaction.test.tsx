import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { Keypair, Transaction } from '@solana/web3.js';
import { GASdfProvider } from './context';

// Mock wallet adapter BEFORE importing the hook
const mockPublicKey = Keypair.generate().publicKey;
const mockSignTransaction = vi.fn();
const mockGetLatestBlockhash = vi.fn();

vi.mock('@solana/wallet-adapter-react', () => ({
  useWallet: vi.fn(() => ({
    publicKey: mockPublicKey,
    signTransaction: mockSignTransaction,
  })),
  useConnection: vi.fn(() => ({
    connection: {
      getLatestBlockhash: mockGetLatestBlockhash,
    },
  })),
}));

// Import after mocks
import { useGaslessTransaction } from './useGaslessTransaction';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <GASdfProvider endpoint="https://test.api">{children}</GASdfProvider>
);

describe('useGaslessTransaction', () => {
  const feePayer = Keypair.generate();

  const createMockQuote = () => ({
    quoteId: 'test-quote',
    feePayer: feePayer.publicKey.toBase58(),
    treasury: { address: 'treasury', ata: null },
    feeAmount: '1000000',
    feeFormatted: '1.00 USDC',
    paymentToken: {
      mint: 'USDC',
      symbol: 'USDC',
      decimals: 6,
      accepted: 'trusted',
      tier: 'TRUSTED',
      kScore: 100,
    },
    holderTier: {
      tier: 'BRONZE',
      emoji: '🥉',
      discountPercent: 0,
      maxDiscountPercent: 20,
      savings: 0,
      asdfBalance: 0,
      nextTier: 'SILVER',
      breakEvenFee: 5000,
      isAtBreakEven: false,
    },
    expiresAt: Date.now() + 60000,
    ttl: 60,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mocks
    vi.mocked(useWallet).mockReturnValue({
      publicKey: mockPublicKey,
      signTransaction: mockSignTransaction,
    } as any);

    vi.mocked(useConnection).mockReturnValue({
      connection: { getLatestBlockhash: mockGetLatestBlockhash },
    } as any);

    mockGetLatestBlockhash.mockResolvedValue({
      blockhash: 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi',
      lastValidBlockHeight: 100000,
    });
  });

  it('should start with idle status', () => {
    const { result } = renderHook(
      () => useGaslessTransaction({ paymentToken: 'USDC' }),
      { wrapper },
    );

    expect(result.current.status).toBe('idle');
    expect(result.current.isLoading).toBe(false);
    expect(result.current.quote).toBeNull();
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('should handle wallet not connected', async () => {
    vi.mocked(useWallet).mockReturnValue({
      publicKey: null,
      signTransaction: null,
    } as any);

    const onError = vi.fn();
    const { result } = renderHook(
      () => useGaslessTransaction({ paymentToken: 'USDC', onError }),
      { wrapper },
    );

    const tx = new Transaction();

    await act(async () => {
      await result.current.execute(tx);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toBe('Wallet not connected');
    expect(onError).toHaveBeenCalled();
  });

  it('should handle wallet without signing capability', async () => {
    vi.mocked(useWallet).mockReturnValue({
      publicKey: mockPublicKey,
      signTransaction: undefined,
    } as any);

    const onError = vi.fn();
    const { result } = renderHook(
      () => useGaslessTransaction({ paymentToken: 'USDC', onError }),
      { wrapper },
    );

    const tx = new Transaction();

    await act(async () => {
      await result.current.execute(tx);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toBe('Wallet does not support signing');
    expect(onError).toHaveBeenCalled();
  });

  it('should handle quote fetch error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Quote failed'));

    const onError = vi.fn();
    const { result } = renderHook(
      () => useGaslessTransaction({ paymentToken: 'USDC', onError }),
      { wrapper },
    );

    // Use empty transaction to avoid SystemProgram issues
    const tx = new Transaction();

    await act(async () => {
      await result.current.execute(tx);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toBe('Quote failed');
    expect(onError).toHaveBeenCalled();
  });

  it('should reset state correctly', () => {
    const { result } = renderHook(
      () => useGaslessTransaction({ paymentToken: 'USDC' }),
      { wrapper },
    );

    act(() => {
      result.current.reset();
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.quote).toBeNull();
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('should call onSuccess callback on success', async () => {
    const mockQuote = createMockQuote();
    const mockSubmitResult = {
      signature: 'TestSignature123',
      explorerUrl: 'https://solscan.io/tx/TestSignature123',
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockQuote),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSubmitResult),
      });

    // Create a mock signed transaction that bypasses serialization issues
    const mockSignedTx = {
      serialize: () => Buffer.from('mocked-transaction'),
      feePayer: feePayer.publicKey,
      signatures: [{ signature: Buffer.alloc(64), publicKey: mockPublicKey }],
    };
    mockSignTransaction.mockResolvedValueOnce(mockSignedTx);

    const onSuccess = vi.fn();
    const { result } = renderHook(
      () => useGaslessTransaction({ paymentToken: 'USDC', onSuccess }),
      { wrapper },
    );

    // Use empty transaction - the actual signing is mocked
    const tx = new Transaction();

    await act(async () => {
      await result.current.execute(tx);
    });

    expect(result.current.status).toBe('success');
    expect(result.current.quote?.quoteId).toBe('test-quote');
    expect(result.current.result?.signature).toBe('TestSignature123');
    expect(onSuccess).toHaveBeenCalledWith(mockSubmitResult);
  });

  it('should handle signing error', async () => {
    const mockQuote = createMockQuote();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockQuote),
    });

    mockSignTransaction.mockRejectedValueOnce(new Error('User rejected'));

    const onError = vi.fn();
    const { result } = renderHook(
      () => useGaslessTransaction({ paymentToken: 'USDC', onError }),
      { wrapper },
    );

    const tx = new Transaction();

    await act(async () => {
      await result.current.execute(tx);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toBe('User rejected');
    expect(onError).toHaveBeenCalled();
  });

  it('should track isLoading correctly', async () => {
    // Create delayed response to test loading states
    let resolveQuote: () => void;
    const quotePromise = new Promise<void>((resolve) => {
      resolveQuote = resolve;
    });

    mockFetch.mockImplementationOnce(() =>
      quotePromise.then(() => {
        throw new Error('fail');
      }),
    );

    const { result } = renderHook(
      () => useGaslessTransaction({ paymentToken: 'USDC' }),
      { wrapper },
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.status).toBe('idle');

    const tx = new Transaction();

    // Start execution without awaiting
    let executePromise: Promise<any>;
    act(() => {
      executePromise = result.current.execute(tx);
    });

    // Wait for loading state to be set
    await vi.waitFor(() => {
      expect(result.current.isLoading).toBe(true);
    });

    // Resolve the promise and complete
    resolveQuote!();
    await act(async () => {
      await executePromise;
    });

    // After completion, isLoading should be false
    expect(result.current.isLoading).toBe(false);
  });
});
