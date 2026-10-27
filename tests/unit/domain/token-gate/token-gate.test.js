/**
 * Tests for token-gate domain (pure, offline).
 */

const {
  createBaseWhitelist,
  isTokenAccepted,
  isWhitelisted,
  getAcceptedTokens,
  mergeHoldexTokens,
} = require('../../../../src/domain/token-gate/token-gate');
const { MINTS, TOKEN_INFO } = require('../../../../src/constants');

test('base whitelist contains all static tokens', () => {
  const wl = createBaseWhitelist(MINTS, TOKEN_INFO);
  expect(wl.size).toBe(5);
  expect(wl.has(MINTS.USDC)).toBe(true);
  expect(wl.has(MINTS.ASDF)).toBe(true);
});

test('isTokenAccepted returns accepted for whitelisted mint', () => {
  const wl = createBaseWhitelist(MINTS, TOKEN_INFO);
  const r = isTokenAccepted(wl, MINTS.USDC);
  expect(r.accepted).toBe(true);
  expect(r.reason).toBe('whitelisted');
});

test('isTokenAccepted returns rejected for unknown mint', () => {
  const wl = createBaseWhitelist(MINTS, TOKEN_INFO);
  const r = isTokenAccepted(wl, 'UnknownMint111111111111111111111111111111');
  expect(r.accepted).toBe(false);
  expect(r.reason).toBe('not_whitelisted');
});

test('isWhitelisted sync check', () => {
  const wl = createBaseWhitelist(MINTS, TOKEN_INFO);
  expect(isWhitelisted(wl, MINTS.USDT)).toBe(true);
  expect(isWhitelisted(wl, 'nope')).toBe(false);
});

test('getAcceptedTokens returns array with mint field', () => {
  const wl = createBaseWhitelist(MINTS, TOKEN_INFO);
  const tokens = getAcceptedTokens(wl);
  expect(tokens.length).toBe(5);
  expect(tokens[0]).toHaveProperty('mint');
  expect(tokens[0]).toHaveProperty('symbol');
});

test('mergeHoldexTokens adds new tokens without mutating original', () => {
  const wl = createBaseWhitelist(MINTS, TOKEN_INFO);
  const originalSize = wl.size;
  const merged = mergeHoldexTokens(wl, [
    { mint: 'CultToken1111111111111111111111111111111', symbol: 'CULT', decimals: 6 },
  ]);
  expect(merged.size).toBe(originalSize + 1);
  expect(wl.size).toBe(originalSize); // original unchanged
  expect(merged.get('CultToken1111111111111111111111111111111').source).toBe('holdex');
});

test('mergeHoldexTokens skips invalid entries', () => {
  const wl = createBaseWhitelist(MINTS, TOKEN_INFO);
  const merged = mergeHoldexTokens(wl, [null, { mint: 'x' }, { symbol: 'no-mint' }]);
  expect(merged.size).toBe(wl.size);
});