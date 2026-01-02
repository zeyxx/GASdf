import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { GASdfProvider, useGASdf } from './context';
import { GASdf } from '../client';

describe('GASdfProvider', () => {
  it('should provide client to children', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <GASdfProvider>{children}</GASdfProvider>
    );

    const { result } = renderHook(() => useGASdf(), { wrapper });

    expect(result.current.client).toBeInstanceOf(GASdf);
  });

  it('should use custom endpoint', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <GASdfProvider endpoint="https://custom.api">{children}</GASdfProvider>
    );

    const { result } = renderHook(() => useGASdf(), { wrapper });

    expect((result.current.client as any).endpoint).toBe('https://custom.api');
  });

  it('should use custom apiKey', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <GASdfProvider apiKey="test-key">{children}</GASdfProvider>
    );

    const { result } = renderHook(() => useGASdf(), { wrapper });

    expect((result.current.client as any).apiKey).toBe('test-key');
  });

  it('should use custom timeout', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <GASdfProvider timeout={5000}>{children}</GASdfProvider>
    );

    const { result } = renderHook(() => useGASdf(), { wrapper });

    expect((result.current.client as any).timeout).toBe(5000);
  });

  it('should provide config object', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <GASdfProvider endpoint="https://test.api" apiKey="key" timeout={10000}>
        {children}
      </GASdfProvider>
    );

    const { result } = renderHook(() => useGASdf(), { wrapper });

    expect(result.current.config).toEqual({
      endpoint: 'https://test.api',
      apiKey: 'key',
      timeout: 10000,
    });
  });
});

describe('useGASdf', () => {
  it('should throw if used outside provider', () => {
    expect(() => {
      renderHook(() => useGASdf());
    }).toThrow('useGASdf must be used within a GASdfProvider');
  });
});
