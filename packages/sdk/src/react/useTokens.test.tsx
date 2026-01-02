import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { GASdfProvider } from './context';
import { useTokens, useTokenScore } from './useTokens';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <GASdfProvider endpoint="https://test.api">{children}</GASdfProvider>
);

describe('useTokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch tokens on mount', async () => {
    const mockTokens = [
      { mint: 'USDC', symbol: 'USDC', decimals: 6 },
      { mint: 'SOL', symbol: 'SOL', decimals: 9 },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ tokens: mockTokens }),
    });

    const { result } = renderHook(() => useTokens(), { wrapper });

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.tokens).toEqual(mockTokens);
    expect(result.current.error).toBeNull();
  });

  it('should handle fetch error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useTokens(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.tokens).toEqual([]);
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('Network error');
  });

  it('should refresh tokens on demand', async () => {
    const mockTokens1 = [{ mint: 'USDC', symbol: 'USDC', decimals: 6 }];
    const mockTokens2 = [
      { mint: 'USDC', symbol: 'USDC', decimals: 6 },
      { mint: 'SOL', symbol: 'SOL', decimals: 9 },
    ];

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ tokens: mockTokens1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ tokens: mockTokens2 }),
      });

    const { result } = renderHook(() => useTokens(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.tokens).toHaveLength(1);

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.tokens).toHaveLength(2);
  });
});

describe('useTokenScore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch score when mint provided', async () => {
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

    const { result } = renderHook(() => useTokenScore('USDC'), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.score).toEqual(mockScore);
    expect(result.current.error).toBeNull();
  });

  it('should not fetch when mint is null', () => {
    const { result } = renderHook(() => useTokenScore(null), { wrapper });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.score).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should handle fetch error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Token not found'));

    const { result } = renderHook(() => useTokenScore('UNKNOWN'), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.score).toBeNull();
    expect(result.current.error?.message).toBe('Token not found');
  });
});
