# GASdf Phase 0 — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remettre GASdf en ligne, supprimer HolDex, corriger le tx size bug, et ajouter le MCP server + gas freedom metric — service prêt pour la Phase 1 (stress test interne).

**Architecture:** Whitelist-only token model (Diamond hardcodé), Jupiter avec `maxAccounts=15 + onlyDirectRoutes=true`, MCP server comme wrapper des endpoints existants, metric `/stats` enrichie d'un "gas freedom %" alimenté par les creator fees token.

**Tech Stack:** Node.js 20, Express 4.21, @solana/web3.js 1.95, Jupiter v6, Redis, Railway/Fly.io (remplacement Render)

---

## PHASE 0 — Réparer le service

### Task 1 : Migration Infrastructure (Render → Railway)

**Contexte :** Le service est down à cause d'une dette Render. Railway offre un free tier viable et un déploiement simple depuis GitHub.

**Files:**
- Create: `railway.json`
- Delete: `render.yaml` (garder pour référence dans git, ne pas supprimer le fichier)
- Modify: `package.json` (vérifier le start script)

**Step 1 : Créer railway.json**

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "npm start",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 30,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

**Step 2 : Vérifier le start script dans package.json**

```bash
cat package.json | grep -A5 '"scripts"'
```
Attendu : `"start": "node src/index.js"` — si différent, noter.

**Step 3 : Variables d'environnement Railway à configurer (manuel)**

Dans le dashboard Railway, configurer ces variables :
```
NODE_ENV=production
HELIUS_API_KEY=<ta clé>
FEE_PAYER_PRIVATE_KEY=<base58 key>
REDIS_URL=<railway redis ou upstash>
ASDF_MINT=9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump
JUPITER_API_KEY=<ta clé>
ALLOWED_ORIGINS=https://asdfasdfa.tech
```

**Step 4 : Commit**

```bash
git add railway.json
git commit -m "infra: add Railway deployment config, migrate from Render"
```

---

### Task 2 : Supprimer HolDex — Whitelist Seulement

**Contexte :** `src/services/token-gate.js` a déjà les Diamond tokens hardcodés. Il faut juste : (1) ajouter $ASDF dans la whitelist Diamond, (2) faire rejeter tout token non-Diamond sans appeler HolDex. Le comportement actuel pour non-Diamond = appel HolDex → on remplace ça par `accepted: false, reason: 'not_whitelisted'`.

**Files:**
- Modify: `src/services/token-gate.js:72-86` (INFRASTRUCTURE_TOKENS) et `src/services/token-gate.js:100-159` (isTokenAccepted)

**Step 1 : Écrire le test qui va échouer**

Dans `tests/unit/token-gate.test.js` (ou créer si absent), ajouter :

```javascript
describe('Token Gate — Whitelist Only Mode', () => {
  it('accepts $ASDF as Diamond token without HolDex call', async () => {
    const result = await isTokenAccepted('9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump');
    expect(result.accepted).toBe(true);
    expect(result.tier).toBe('Diamond');
  });

  it('rejects unknown community token without calling HolDex', async () => {
    const result = await isTokenAccepted('UnknownTokenMintAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('not_whitelisted');
  });
});
```

**Step 2 : Vérifier que le test échoue**

```bash
cd /c/Users/zeyxm/Desktop/asdfasdfa/GASdf
npm test -- --testPathPattern="token-gate" --verbose
```
Attendu : FAIL — $ASDF non accepté, et le test "not_whitelisted" n'existe pas encore.

**Step 3 : Modifier token-gate.js**

Dans `src/services/token-gate.js`, ligne 72, ajouter $ASDF à INFRASTRUCTURE_TOKENS :

```javascript
const INFRASTRUCTURE_TOKENS = new Set([
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // mSOL
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', // jitoSOL
  '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump', // $ASDF — 100% burn channel
]);
```

Dans `src/services/token-gate.js`, fonction `isTokenAccepted` (ligne ~100), remplacer le bloc après le check Diamond :

```javascript
async function isTokenAccepted(mint) {
  // Check whitelist locally (instant, no network call)
  if (DIAMOND_TOKENS.has(mint)) {
    const kRank = { tier: 'Diamond', level: 9 };
    const creditRating = { grade: 'A1' };
    return {
      accepted: true,
      reason: 'diamond',
      tier: 'Diamond',
      kScore: 100,
      kRank,
      creditRating,
    };
  }

  // Phase 1: Whitelist-only — reject all non-Diamond tokens
  // HolDex integration planned for Phase 2 (when stable)
  logger.info('TOKEN_GATE', 'Token rejected — not in whitelist', {
    mint: mint.slice(0, 8),
  });
  return {
    accepted: false,
    reason: 'not_whitelisted',
    tier: 'Rejected',
    kScore: 0,
  };
}
```

**Step 4 : Vérifier que les tests passent**

```bash
npm test -- --testPathPattern="token-gate" --verbose
```
Attendu : PASS

**Step 5 : Run la suite complète pour détecter les régressions**

```bash
npm test
```
Attendu : les tests HolDex-dépendants peuvent échouer — noter lesquels, ils seront corrigés dans Task 3.

**Step 6 : Commit**

```bash
git add src/services/token-gate.js tests/
git commit -m "feat: whitelist-only token model, remove HolDex dependency

Phase 1 token acceptance: USDC, USDT, mSOL, jitoSOL, \$ASDF (Diamond hardcoded)
All non-Diamond tokens rejected without external API call
HolDex integration preserved for Phase 2 reactivation"
```

---

### Task 3 : Nettoyer les Routes HolDex

**Contexte :** `src/routes/holdex.js` existe et est monté dans `src/index.js`. On ne supprime pas le fichier (garde la logique pour Phase 2) mais on désactive le mount.

**Files:**
- Modify: `src/index.js:26-27` (holdex import et mount)

**Step 1 : Dans src/index.js, commenter/supprimer le mount HolDex**

Trouver la ligne `const holdexRouter = require('./routes/holdex');` et son `app.use(...)`.
Les remplacer par :

```javascript
// HolDex routes — Phase 2 (currently using whitelist-only model)
// const holdexRouter = require('./routes/holdex');
```

Et commenter le `app.use('/v1/tokens/holdex', holdexRouter)` correspondant.

**Step 2 : Vérifier que le serveur démarre toujours**

```bash
npm run dev
```
Attendu : serveur up sur port 3000, `/health` répond 200.

**Step 3 : Commit**

```bash
git add src/index.js
git commit -m "chore: disable HolDex route mount (whitelist-only phase)"
```

---

### Task 4 : Fix Transaction Size — Jupiter maxAccounts

**Contexte :** `src/services/jupiter.js:getQuote()` ligne 65 construit les URLSearchParams sans `maxAccounts` ni `onlyDirectRoutes`. On les ajoute pour garantir que les txs restent sous 1232 bytes.

**Files:**
- Modify: `src/services/jupiter.js:64-71`

**Step 1 : Écrire le test**

Dans le fichier de tests Jupiter (chercher `tests/unit/jupiter.test.js` ou équivalent), ajouter :

```javascript
it('includes maxAccounts=15 and onlyDirectRoutes in quote params', async () => {
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
    ok: true,
    json: async () => ({ outAmount: '1000' }),
  });

  await getQuote('USDC_MINT', 'SOL_MINT', 1000);

  const calledUrl = fetchMock.mock.calls[0][0];
  expect(calledUrl).toContain('maxAccounts=15');
  expect(calledUrl).toContain('onlyDirectRoutes=true');
});
```

**Step 2 : Vérifier que le test échoue**

```bash
npm test -- --testPathPattern="jupiter" --verbose
```
Attendu : FAIL — params absents.

**Step 3 : Modifier src/services/jupiter.js**

À la ligne ~65, dans `getQuote`, modifier le bloc URLSearchParams :

```javascript
const params = new URLSearchParams({
  inputMint,
  outputMint,
  amount: amount.toString(),
  slippageBps: slippageBps.toString(),
  maxAccounts: '15',          // Fix: keep tx under 1232 bytes
  onlyDirectRoutes: 'true',   // Fix: avoid multi-hop bloat
});
```

**Step 4 : Run les tests**

```bash
npm test -- --testPathPattern="jupiter" --verbose
```
Attendu : PASS

**Step 5 : Test manuel de la taille de tx**

Si le service tourne localement :
```bash
curl -s -X POST http://localhost:3000/v1/quote \
  -H "Content-Type: application/json" \
  -d '{"paymentToken":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","userPubkey":"11111111111111111111111111111111"}'
```
Attendu : réponse JSON avec `quoteId` (pas d'erreur de taille).

**Step 6 : Commit**

```bash
git add src/services/jupiter.js tests/
git commit -m "fix: limit Jupiter routes to 15 accounts max, direct routes only

Prevents tx size overflow (1521 > 1232 bytes Solana MTU limit)
Trade-off: slightly worse prices on some pairs, no complex routes
ALT support planned for Phase 2"
```

---

### Task 5 : Metric Gas Freedom dans /v1/stats

**Contexte :** Le dashboard doit montrer "% vers gas gratuit" en temps réel. La métrique est calculée depuis les données de creator fees (stockées en Redis quand le token sera lancé) vs coût gas réel. En Phase 0, la valeur est 0% — mais l'endpoint et le champ existent déjà pour être live dès le lancement token.

**Files:**
- Modify: `src/routes/stats.js` (ajouter le champ `gasFreedompct`)
- Modify: `public/index.html` (afficher la métrique)

**Step 1 : Écrire le test**

```javascript
it('GET /v1/stats includes gasFreedomPct field', async () => {
  const res = await request(app).get('/v1/stats');
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('gasFreedomPct');
  expect(typeof res.body.gasFreedomPct).toBe('number');
  expect(res.body.gasFreedomPct).toBeGreaterThanOrEqual(0);
  expect(res.body.gasFreedomPct).toBeLessThanOrEqual(100);
});
```

**Step 2 : Vérifier que le test échoue**

```bash
npm test -- --testPathPattern="stats" --verbose
```
Attendu : FAIL — `gasFreedomPct` absent.

**Step 3 : Modifier src/routes/stats.js**

Ajouter la fonction de calcul avant le router.get('/') :

```javascript
/**
 * Calculate gas freedom percentage
 * gasFreedomPct = min(100, (dailyCreatorFees / dailyGasCost) * 100)
 *
 * Phase 0: always 0 (token not launched yet)
 * Phase 1+: populated from Redis key 'gasdf:creator_fees:daily_usd'
 */
async function getGasFreedomPct(txCount24h) {
  try {
    const dailyCreatorFeesUSD = parseFloat(
      await redis.get('gasdf:creator_fees:daily_usd') || '0'
    );
    const SOL_PRICE_USD = 150; // TODO: use Pyth feed
    const GAS_COST_PER_TX = 0.000005 * SOL_PRICE_USD; // 5000 lamports
    const dailyGasCostUSD = (txCount24h || 0) * GAS_COST_PER_TX;

    if (dailyGasCostUSD === 0) return 0;
    return Math.min(100, Math.round((dailyCreatorFeesUSD / dailyGasCostUSD) * 100));
  } catch {
    return 0;
  }
}
```

Dans le handler `router.get('/')`, ajouter le champ dans la réponse :

```javascript
const gasFreedomPct = await getGasFreedomPct(stats.txCount24h || 0);

res.json({
  // ...champs existants...
  gasFreedomPct,
  gasFreedomLabel: gasFreedomPct === 0
    ? 'Token not launched yet'
    : gasFreedomPct >= 100
      ? 'Gas is FREE'
      : `${gasFreedomPct}% covered`,
});
```

**Step 4 : Vérifier que les tests passent**

```bash
npm test -- --testPathPattern="stats" --verbose
```
Attendu : PASS

**Step 5 : Commit**

```bash
git add src/routes/stats.js tests/
git commit -m "feat: add gasFreedomPct metric to /v1/stats

Tracks % of gas costs covered by GASdf token creator fees.
Phase 0: always 0% (token not launched).
Phase 1+: live as creator fees populate Redis key."
```

---

## PHASE 1 — Prouver (MCP + Stress Test)

### Task 6 : GASdf MCP Server

**Contexte :** Un MCP server expose GASdf comme un tool utilisable par Claude, Cursor, et n'importe quel agent compatible MCP. C'est le vecteur de distribution dans le stack Helius/DFlow. Le MCP est un wrapper fin des endpoints existants — pas de logique métier dedans.

**Files:**
- Create: `src/mcp/server.js`
- Create: `src/mcp/tools.js`
- Modify: `package.json` (ajouter script mcp)

**Step 1 : Installer le SDK MCP**

```bash
npm install @modelcontextprotocol/sdk
```

**Step 2 : Créer src/mcp/tools.js**

```javascript
/**
 * GASdf MCP Tools
 * Exposes GASdf endpoints as MCP tools for AI agents
 */

const BASE_URL = process.env.GASDF_API_URL || 'https://asdfasdfa.tech';

const TOOLS = [
  {
    name: 'gasdf_quote',
    description: 'Get a gasless transaction quote. Returns a quoteId and feePayer address. The agent must build a transaction using feePayer as the fee payer, sign it, then call gasdf_submit.',
    inputSchema: {
      type: 'object',
      properties: {
        paymentToken: {
          type: 'string',
          description: 'Token mint address to pay gas with. Accepted: USDC (EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v), USDT (Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB), $ASDF (9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump)'
        },
        userPubkey: {
          type: 'string',
          description: 'The user/agent wallet public key (base58)'
        }
      },
      required: ['paymentToken', 'userPubkey']
    }
  },
  {
    name: 'gasdf_submit',
    description: 'Submit a signed transaction for gasless execution. The transaction must use the feePayer from gasdf_quote. GASdf co-signs and broadcasts to Solana.',
    inputSchema: {
      type: 'object',
      properties: {
        quoteId: {
          type: 'string',
          description: 'Quote ID from gasdf_quote (valid 60 seconds)'
        },
        transaction: {
          type: 'string',
          description: 'Base64-encoded signed transaction'
        },
        userPubkey: {
          type: 'string',
          description: 'The user/agent wallet public key (base58)'
        }
      },
      required: ['quoteId', 'transaction', 'userPubkey']
    }
  },
  {
    name: 'gasdf_tokens',
    description: 'List all tokens accepted as gas payment by GASdf.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'gasdf_stats',
    description: 'Get GASdf burn statistics: total $ASDF burned, gas freedom percentage, and transaction count.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];

async function callTool(name, args) {
  const fetch = (await import('node-fetch')).default;

  switch (name) {
    case 'gasdf_quote': {
      const res = await fetch(`${BASE_URL}/v1/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args)
      });
      return res.json();
    }
    case 'gasdf_submit': {
      const res = await fetch(`${BASE_URL}/v1/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args)
      });
      return res.json();
    }
    case 'gasdf_tokens': {
      const res = await fetch(`${BASE_URL}/v1/tokens`);
      return res.json();
    }
    case 'gasdf_stats': {
      const res = await fetch(`${BASE_URL}/v1/stats`);
      return res.json();
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

module.exports = { TOOLS, callTool };
```

**Step 3 : Créer src/mcp/server.js**

```javascript
#!/usr/bin/env node
/**
 * GASdf MCP Server
 * Exposes gasless transaction infrastructure as MCP tools for AI agents
 *
 * Usage:
 *   node src/mcp/server.js
 *
 * Claude Code config (~/.claude/mcp.json):
 *   {
 *     "gasdf": {
 *       "command": "node",
 *       "args": ["/path/to/GASdf/src/mcp/server.js"],
 *       "env": { "GASDF_API_URL": "https://asdfasdfa.tech" }
 *     }
 *   }
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const { TOOLS, callTool } = require('./tools');

const server = new Server(
  { name: 'gasdf', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await callTool(name, args || {});
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('GASdf MCP server running');
}

main().catch(console.error);
```

**Step 4 : Ajouter le script dans package.json**

Dans la section `"scripts"`, ajouter :
```json
"mcp": "node src/mcp/server.js"
```

**Step 5 : Test manuel du MCP**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node src/mcp/server.js
```
Attendu : JSON avec les 4 tools listés.

**Step 6 : Commit**

```bash
git add src/mcp/ package.json package-lock.json
git commit -m "feat: add GASdf MCP server

Exposes gasdf_quote, gasdf_submit, gasdf_tokens, gasdf_stats as MCP tools.
AI agents (Claude Code, Cursor, etc.) can now use GASdf directly.
Distribution vector: Helius/DFlow agent ecosystem."
```

---

### Task 7 : Stress Agent Interne (Validation Phase 1)

**Contexte :** Pour valider le service sous charge réelle sans dépendre d'utilisateurs externes, un script tourne en boucle et fait des quotes + submits avec un vrai wallet de test. C'est aussi un démo live du cas d'usage agent.

**Files:**
- Create: `scripts/stress-agent.js`

**Step 1 : Créer scripts/stress-agent.js**

```javascript
#!/usr/bin/env node
/**
 * GASdf Stress Agent — Internal Validation
 *
 * Simulates an AI agent making gasless transactions in a loop.
 * Used to:
 *   - Validate service under real load before public launch
 *   - Demo the AI agent use case
 *   - Generate real burn data for dashboard
 *
 * Usage:
 *   GASDF_URL=https://asdfasdfa.tech \
 *   AGENT_WALLET=<base58 private key> \
 *   node scripts/stress-agent.js
 *
 * The agent wallet needs a small USDC balance to pay fees.
 */

const BASE_URL = process.env.GASDF_URL || 'http://localhost:3000';
const PAYMENT_TOKEN = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC
const INTERVAL_MS = parseInt(process.env.INTERVAL_MS || '5000'); // 5s default
const MAX_CYCLES = parseInt(process.env.MAX_CYCLES || '100');

let cycles = 0;
let successes = 0;
let failures = 0;

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  });
  return res.json();
}

async function runCycle(agentPubkey) {
  console.log(`\n[Cycle ${cycles + 1}/${MAX_CYCLES}]`);

  // 1. Quote
  const quote = await fetchJSON(`${BASE_URL}/v1/quote`, {
    method: 'POST',
    body: JSON.stringify({ paymentToken: PAYMENT_TOKEN, userPubkey: agentPubkey })
  });

  if (!quote.quoteId) {
    console.error('Quote failed:', quote);
    failures++;
    return;
  }

  console.log(`  Quote: ${quote.quoteId} | Fee: ${quote.feeFormatted} | Payer: ${quote.feePayer?.slice(0, 8)}...`);

  // 2. In a real agent: build tx, sign, submit
  // For stress test: just verify quote works (no real tx without funded wallet)
  console.log(`  Status: quote OK (real tx submission requires funded agent wallet)`);
  successes++;
}

async function getAgentPubkey() {
  if (!process.env.AGENT_WALLET) {
    // Use a dummy pubkey for quote-only testing
    return '11111111111111111111111111111111';
  }
  const { Keypair } = await import('@solana/web3.js');
  const bs58 = await import('bs58');
  const kp = Keypair.fromSecretKey(bs58.default.decode(process.env.AGENT_WALLET));
  return kp.publicKey.toBase58();
}

async function printStats() {
  const stats = await fetchJSON(`${BASE_URL}/v1/stats`);
  console.log('\n=== GASdf Stats ===');
  console.log(`  Total burned: ${stats.totalBurned || 0} $ASDF`);
  console.log(`  Gas freedom: ${stats.gasFreedomPct || 0}%`);
  console.log(`  Tx count: ${stats.txCount || 0}`);
  console.log(`  Agent cycles: ${cycles} | OK: ${successes} | ERR: ${failures}`);
}

async function main() {
  console.log(`GASdf Stress Agent`);
  console.log(`Target: ${BASE_URL}`);
  console.log(`Interval: ${INTERVAL_MS}ms | Max cycles: ${MAX_CYCLES}\n`);

  const agentPubkey = await getAgentPubkey();
  console.log(`Agent wallet: ${agentPubkey.slice(0, 8)}...`);

  // Health check
  const health = await fetchJSON(`${BASE_URL}/health`);
  if (health.status !== 'ok') {
    console.error('Service unhealthy:', health);
    process.exit(1);
  }
  console.log('Service: HEALTHY\n');

  while (cycles < MAX_CYCLES) {
    try {
      await runCycle(agentPubkey);
    } catch (e) {
      console.error('Cycle error:', e.message);
      failures++;
    }
    cycles++;

    if (cycles % 10 === 0) await printStats();
    await new Promise(r => setTimeout(r, INTERVAL_MS));
  }

  await printStats();
  console.log('\nStress test complete.');
}

main().catch(console.error);
```

**Step 2 : Ajouter le script dans package.json**

```json
"stress": "node scripts/stress-agent.js"
```

**Step 3 : Test du script contre le service local**

```bash
npm run dev &
sleep 3
GASDF_URL=http://localhost:3000 MAX_CYCLES=5 npm run stress
```
Attendu : 5 cycles, quotes OK, stats affichées.

**Step 4 : Commit**

```bash
git add scripts/stress-agent.js package.json
git commit -m "feat: add internal stress agent for Phase 1 validation

Simulates AI agent making gasless tx in a loop.
Validates service under load before public launch.
Demo of the primary use case: agents without SOL."
```

---

### Task 8 : Documentation MCP pour Developers

**Contexte :** Un fichier `MCP.md` à la racine explique comment un developer Helius/DFlow configure GASdf dans son stack en 3 minutes. C'est le document de distribution.

**Files:**
- Create: `MCP.md`

**Step 1 : Créer MCP.md**

```markdown
# GASdf MCP — Gasless Solana for AI Agents

Add gasless transaction execution to your Solana agent in 3 minutes.

## What it does

Your agent pays gas in USDC/USDT/$ASDF instead of SOL.
Every fee burns $ASDF. Gas gets cheaper as the token grows.

## Install

### Claude Code
Add to `~/.claude/mcp.json`:
\`\`\`json
{
  "gasdf": {
    "command": "npx",
    "args": ["gasdf-mcp"],
    "env": {}
  }
}
\`\`\`

### Manual (any MCP client)
\`\`\`bash
npm install -g gasdf-mcp
gasdf-mcp  # stdio transport, connects to https://asdfasdfa.tech
\`\`\`

## Tools

| Tool | Description |
|------|-------------|
| `gasdf_quote` | Get fee quote + feePayer address (60s TTL) |
| `gasdf_submit` | Submit signed tx for gasless execution |
| `gasdf_tokens` | List accepted payment tokens |
| `gasdf_stats` | Burn stats + gas freedom % |

## Usage Example

\`\`\`
Agent: I want to swap 10 USDC to SOL without managing SOL for gas.

1. Call gasdf_quote with paymentToken=USDC, userPubkey=<my wallet>
2. Build swap transaction with feePayer=<from quote>
3. Sign transaction with my wallet
4. Call gasdf_submit with quoteId + signed tx
5. Transaction lands on-chain, gas paid in USDC
\`\`\`

## Accepted Tokens
- **USDC** — `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- **USDT** — `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`
- **$ASDF** — `9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump` (100% burn, no treasury cut)

## Gas Freedom

Creator fees from the GASdf token fund the fee payer.
As trading volume grows, gas costs drop toward zero.
Track progress: [asdfasdfa.tech/analytics.html](https://asdfasdfa.tech/analytics.html)

## Links
- API: https://asdfasdfa.tech
- SDK: `npm install gasdf-sdk`
- GitHub: https://github.com/zeyxx/GASdf
```

**Step 2 : Commit**

```bash
git add MCP.md
git commit -m "docs: add MCP.md — 3-minute setup guide for agent developers"
```

---

## Checklist de Validation Finale

Avant de passer en Phase 1 (lancement interne), vérifier :

```
□ Railway déployé, /health répond 200
□ npm test — 0 failures
□ curl /v1/tokens → USDC, USDT, mSOL, jitoSOL, $ASDF (5 tokens)
□ curl /v1/quote avec USDC → quoteId retourné
□ curl /v1/quote avec token inconnu → 400 "not_whitelisted"
□ curl /v1/stats → gasFreedomPct présent (valeur 0)
□ echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node src/mcp/server.js → 4 tools
□ MAX_CYCLES=10 npm run stress → 10 cycles OK
□ Fee payer wallet financé (minimum 0.1 SOL)
```

---

*Plan créé le 08/03/2026 — Phase 0 : Réparer. Phase 1 : Prouver.*
