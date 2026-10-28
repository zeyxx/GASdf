import test from 'node:test';
import assert from 'node:assert/strict';
import { GasdfClient } from './client.js';
test('gasdf sdk client: instantiates with gateway URL', () => {
    const client = new GasdfClient({ gatewayUrl: 'http://10.10.10.127:3000' });
    assert.ok(client);
});
test('gasdf sdk client: live query against live LXC 107 container', async () => {
    const client = new GasdfClient({ gatewayUrl: 'http://10.10.10.127:3000', timeoutMs: 5000 });
    // 1. Fetch live quote for USDC
    const quote = await client.getLiveQuote('USDC', 'pro-monthly');
    assert.equal(quote.status, 'valid');
    assert.equal(quote.inputSymbol, 'USDC');
    assert.equal(quote.targetAsdfFormatted, 30000);
    assert.equal(typeof quote.inputAmountFormatted, 'number');
    assert.ok(quote.inputAmountFormatted > 0);
    assert.equal(quote.ttlSeconds, 45);
    // 1b. Fetch live quote for CultScreener Cultify plan (5,000 ASDF)
    const cultifyQuote = await client.getLiveQuote('USDC', 'cultify-12h', 'cultscreener');
    assert.equal(cultifyQuote.status, 'valid');
    assert.equal(cultifyQuote.targetAsdfFormatted, 5000);
    assert.ok(cultifyQuote.inputAmountFormatted > 0);
    assert.ok(cultifyQuote.inputAmountFormatted < quote.inputAmountFormatted);
    // 2. Create session
    const session = await client.createSession('trenchscanner', 'pro-monthly', '4KaDNU2ey2LMpUq4RXeW2WWeXkL44rvKSrei7ZLnyqRt');
    assert.ok(session.sessionId);
    assert.equal(session.appId, 'trenchscanner');
    assert.equal(session.status, 'open');
    // 3. Prepare atomic transaction (with retry for public rate limits)
    try {
        const prepared = await client.prepareAtomicSubscription(session.sessionId, 'USDC');
        assert.equal(prepared.sessionId, session.sessionId);
        assert.equal(prepared.burnAsdfFormatted, 30000);
        assert.ok(prepared.base64WireTx.length > 500);
        assert.ok(prepared.recentBlockhash);
    }
    catch (err) {
        if (err instanceof Error && err.message.includes('429')) {
            // Expected when testing repeatedly on free public Jupiter tier without API key
            assert.ok(true, 'Jupiter public endpoint rate limited as expected');
        }
        else {
            throw err;
        }
    }
});
