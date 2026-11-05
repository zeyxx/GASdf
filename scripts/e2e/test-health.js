#!/usr/bin/env node
const API_URL = process.env.API_URL || 'https://relay.talaria.build';

async function fetchJson(url) {
  const res = await fetch(url);
  return { status: res.status, data: await res.json() };
}

async function main() {
  console.log(`API: ${API_URL}`);
  const { status, data } = await fetchJson(`${API_URL}/health`);
  console.log(`Health: ${status} - ${data.status} (v${data.version}, sha:${data.gitSha})`);
  console.log(`Kora: ${data.checks?.kora?.status}, Facilitator: ${data.checks?.facilitator?.status}`);

  const tokens = await fetchJson(`${API_URL}/subscription/tokens`);
  console.log(`Tokens: ${tokens.data.tokens.length} (${tokens.data.tokens.map(t => t.symbol).join(', ')})`);

  const plans = await fetchJson(`${API_URL}/subscription/plans`);
  console.log(`Plans: ${plans.data.plans.length} (${plans.data.plans.map(p => p.planId).join(', ')})`);

  const quote = await fetch(`${API_URL}/subscription/quote/live?token=USDC&targetAsdf=30000`);
  const qd = await quote.json();
  console.log(`Quote: ${qd.status} - ${qd.inputAmountFormatted} ${qd.inputSymbol} (ttl: ${qd.ttlSeconds}s)`);

  console.log('\nAll checks passed.');
}

main().catch(e => { console.error(e); process.exit(1); });
