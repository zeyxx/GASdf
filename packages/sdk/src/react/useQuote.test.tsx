import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { Keypair } from '@solana/web3.js';
import { GASdfProvider } from './context';

// Mock wallet adapter BEFORE importing useQuote
const mockPublicKey = Keypair.generate().publicKey;
vi.mock('@solana/wallet-adapter-react', () => ({
  useWallet: vi.fn(() => ({
    publicKey: mockPublicKey,
  })),
}));

// Import after mock is set up
import { useQuote } from './useQuote';
import { useWallet } from '@solana/wallet-adapter-react';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <GASdfProvider endpoint="https://test.api">{children}</GASdfProvider>
);

describe('useQuote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Reset wallet mock
    vi.mocked(useWallet).mockReturnValue({ publicKey: mockPublicKey } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const createMockQuote = (overrides = {}) => ({
    quoteId: 'test-quote',
    feePayer: Keypair.generate().publicKey.toBase58(),
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
    ...overrides,
  });

  it('should not fetch when paymentToken is null', () => {
    const { result } = renderHook(() => useQuote({ paymentToken: null }), {
      wrapper,
    });

    expect(result.current.quote).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should not fetch when wallet not connected', () => {
    vi.mocked(useWallet).mockReturnValue({ publicKey: null } as any);

    const { result } = renderHook(() => useQuote({ paymentToken: 'USDC' }), {
      wrapper,
    });

    expect(result.current.quote).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should fetch quote when wallet connected and token provided', async () => {
    const mockQuote = createMockQuote();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockQuote),
    });

    const { result } = renderHook(() => useQuote({ paymentToken: 'USDC' }), {
      wrapper,
    });

    // Should start loading
    expect(result.current.isLoading).toBe(true);

    await vi.waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.quote).toBeTruthy();
    expect(result.current.quote?.quoteId).toBe('test-quote');
    expect(result.current.isValid).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('should handle fetch error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('API error'));

    const { result } = renderHook(() => useQuote({ paymentToken: 'USDC' }), {
      wrapper,
    });

    await vi.waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.quote).toBeNull();
    expect(result.current.isValid).toBe(false);
    expect(result.current.error?.message).toBe('API error');
  });

  it('should mark quote as invalid when expired', async () => {
    const expiredQuote = createMockQuote({ expiresAt: Date.now() + 2000 });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(expiredQuote),
    });

    const { result } = renderHook(() => useQuote({ paymentToken: 'USDC' }), {
      wrapper,
    });

    await vi.waitFor(() => {
      expect(result.current.quote).toBeTruthy();
    });

    expect(result.current.isValid).toBe(true);

    // Advance time past expiry
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    await vi.waitFor(() => {
      expect(result.current.isValid).toBe(false);
    });
  });

  it('should allow manual refresh', async () => {
    const quote1 = createMockQuote({ quoteId: 'quote-1' });
    const quote2 = createMockQuote({ quoteId: 'quote-2' });

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(quote1),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(quote2),
      });

    const { result } = renderHook(
      () => useQuote({ paymentToken: 'USDC', autoRefresh: false }),
      { wrapper },
    );

    await vi.waitFor(() => {
      expect(result.current.quote?.quoteId).toBe('quote-1');
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.quote?.quoteId).toBe('quote-2');
  });
});
