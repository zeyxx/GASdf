/**
 * Relay gateway composition root. No secrets here: everything sensitive comes
 * from the environment (Kora HMAC, Jupiter key, signer file loaded by the
 * launcher, never baked into code).
 *
 * Required env: KORA_URL, KORA_HMAC_SECRET, KORA_SIGNER, RPC_URL.
 * Optional env: JUPITER_API_KEY, X402_PAY_TO, X402_NETWORK, PORT,
 * OUTPUT_MINT (default: WSOL; USDC for the dollar leg).
 */
import { address } from '@solana/kit';
import { estimateFee, signAndSend, type KoraConfig } from './kora/client.js';
import { ASDF_MINT, WSOL_MINT, buildSponsoredSell } from './builder/setup-aware.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing env ${name}`);
  return value;
}

const kora: KoraConfig = { url: required('KORA_URL'), hmacSecret: required('KORA_HMAC_SECRET') };
const KORA_SIGNER = address(required('KORA_SIGNER'));
const RPC_URL = required('RPC_URL');

export async function sponsoredSellOnce(user: {
  wallet: ReturnType<typeof address>;
  signer: import('@solana/kit').TransactionSigner;
}): Promise<{ signature: string; quoteOutAmount: string; feeInToken: bigint }> {
  const { base64Tx, quoteOutAmount, feeInToken } = await buildSponsoredSell({
    rpcUrl: RPC_URL,
    kora,
    koraSigner: KORA_SIGNER,
    user,
    inputMint: ASDF_MINT,
    outputMint: process.env['OUTPUT_MINT'] ? address(process.env['OUTPUT_MINT']) : WSOL_MINT,
    amount: 1_000_000n,
    feeToken: ASDF_MINT,
    jupiterApiKey: process.env['JUPITER_API_KEY'],
    feeBufferBps: 500n,
  });
  // Pre-flight through estimate so a bad tx never reaches the signer.
  await estimateFee(kora, base64Tx, ASDF_MINT.toString());
  const signature = await signAndSend(kora, base64Tx);
  return { signature, quoteOutAmount, feeInToken };
}

/**
 * HTTP composition: x402-gated relay route wired to the (local by default)
 * self-facilitator. The dev user key signs the sponsored leg; production
 * callers will submit their own partial signatures instead.
 *
 * Env: PORT (default 3000), X402_PRICE (default "$0.005"),
 * X402_PAY_TO (default: facilitator account), X402_NETWORK,
 * X402_FACILITATOR_URL (default "http://localhost:4021"),
 * USER_KEY_PATH (dev user secret-key file).
 */
export async function startServer(): Promise<void> {
  const { default: express } = await import('express');
  const {
    relayPaymentMiddleware,
    uptoRelayPaymentMiddleware,
    setSettlementOverrides,
  } = await import('./facilitator/x402.js');
  const { createKeyPairSignerFromBytes } = await import('@solana/kit');
  const { readFileSync } = await import('node:fs');

  const userSecret = new Uint8Array(
    JSON.parse(readFileSync(required('USER_KEY_PATH'), 'utf8')),
  );
  const userSigner = await createKeyPairSignerFromBytes(userSecret);

  const network = (process.env['X402_NETWORK'] ??
    'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp') as `${string}:${string}`;
  const facilitatorUrl =
    process.env['X402_FACILITATOR_URL'] ?? 'http://localhost:4021';
  const payTo =
    process.env['X402_PAY_TO'] ?? '4KaDNU2ey2LMpUq4RXeW2WWeXkL44rvKSrei7ZLnyqRt';

  const app = express();
  app.use(express.json());

  // Serve static UI from public/
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const publicDir = join(__dirname, '../public');
  app.use(express.static(publicDir));

  // Accounting ledger
  const { LedgerService } = await import('./ledger/ledger.js');
  const ledgerPath = process.env['LEDGER_PATH'] ?? 'data/ledger.jsonl';
  const ledger = new LedgerService(ledgerPath);

  // Subscription API routes
  const { createSubscriptionRouter } = await import('./subscription/router.js');
  const { SqliteSessionStore } = await import('./adapters/storage/sqlite-session-store.js');
  const sqliteDbPath = process.env['SQLITE_DB_PATH'] ?? 'data/gasdf.sqlite';
  const sessionStore = new SqliteSessionStore(sqliteDbPath);
  const tokenRegistry = JSON.parse(
    readFileSync(
      new URL('../../contracts/subscription-reference/fixtures/payment-tokens.json', import.meta.url),
      'utf8',
    ),
  );
  // Normalize snake_case fixture keys to camelCase domain model
  const normalizedTokens = {
    schema: tokenRegistry.schema,
    tokens: tokenRegistry.tokens.map((t: any) => ({
      mint: t.mint,
      symbol: t.symbol,
      decimals: t.decimals,
      kind: t.kind,
      enabled: t.enabled,
      minAmount: t.min_amount,
      slippageBpsDefault: t.slippage_bps_default,
    })),
    limits: {
      maxSlippageBps: tokenRegistry.limits.max_slippage_bps,
      quoteTtlSeconds: tokenRegistry.limits.quote_ttl_seconds,
      minQuoteAmountAsdf: tokenRegistry.limits.min_quote_amount_asdf,
    },
  };
  const planRegistry = JSON.parse(
    readFileSync(
      new URL('../../contracts/subscription-reference/fixtures/plans.json', import.meta.url),
      'utf8',
    ),
  );
  const normalizedPlans = {
    schema: planRegistry.schema,
    plans: planRegistry.plans.map((p: any) => ({
      appId: p.app_id,
      planId: p.plan_id,
      name: p.name,
      priceAsdfBaseUnits: p.price_asdf_base_units,
      durationSeconds: p.duration_seconds,
      enabled: p.enabled,
    })),
  };
  app.use(
    '/subscription',
    createSubscriptionRouter(
      normalizedTokens,
      normalizedPlans,
      sessionStore,
      ledger,
      undefined,
      kora,
      KORA_SIGNER.toString(),
    ),
  );
  app.use(
    relayPaymentMiddleware({
      price: (process.env['X402_PRICE'] ?? '$0.005') as `$${string}`,
      payTo,
      network,
      facilitatorUrl,
    }),
  );
  app.post('/relay/send', async (_req, res) => {
    try {
      const out = await sponsoredSellOnce({ wallet: userSigner.address, signer: userSigner });
      ledger.record({
        kind: 'relay_x402',
        id: out.signature,
        usdValueApprox: 0.005,
        metadata: {
          quoteOutAmount: out.quoteOutAmount,
          feeInToken: out.feeInToken.toString(),
        },
      });
      res.json({ signature: out.signature, quoteOutAmount: out.quoteOutAmount });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // Upto route: channel ceiling $0.10, each relay settles its actual $0.005.
  // Disabled unless UPTO_AUTHORIZER_KEY_PATH is set (server hot key).
  const authorizerPath = process.env['UPTO_AUTHORIZER_KEY_PATH'];
  if (authorizerPath) {
    const authorizerSecret = new Uint8Array(JSON.parse(readFileSync(authorizerPath, 'utf8')));
    const receiverAuthorizerSigner = await createKeyPairSignerFromBytes(authorizerSecret);
    app.use(
      uptoRelayPaymentMiddleware({
        price: '$0.005',
        ceiling: '$0.10',
        payTo,
        network,
        facilitatorUrl,
        receiverAuthorizerSigner,
      }),
    );
    app.post('/relay/send-upto', async (_req, res) => {
      try {
        const out = await sponsoredSellOnce({ wallet: userSigner.address, signer: userSigner });
        setSettlementOverrides(res, { amount: '5000' });
        ledger.record({
          kind: 'relay_x402',
          id: out.signature,
          usdValueApprox: 0.005,
          metadata: {
            channel: 'upto',
            quoteOutAmount: out.quoteOutAmount,
            feeInToken: out.feeInToken.toString(),
          },
        });
        res.json({ signature: out.signature, quoteOutAmount: out.quoteOutAmount });
      } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
      }
    });
  }
  app.get('/health', async (_req, res) => {
    const koraUrl = process.env['KORA_URL'] ?? 'http://localhost:14001';
    const facilitatorUrl = process.env['FACILITATOR_URL'] ?? 'http://localhost:4021';

    let koraOk = false;
    let facilitatorOk = false;
    try {
      const r = await fetch(`${koraUrl}/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'liveness', id: 1 }) });
      koraOk = r.ok || r.status === 405; // 405 = method not allowed but server is up
    } catch { koraOk = false; }
    try {
      const r = await fetch(`${facilitatorUrl}/supported`);
      facilitatorOk = r.ok;
    } catch { facilitatorOk = false; }

    const healthy = koraOk && facilitatorOk;
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      service: 'relay-gateway',
      version: process.env['BUILD_VERSION'] ?? '0.1.0',
      gitSha: process.env['GIT_SHA'] ?? 'unknown',
      buildDate: process.env['BUILD_DATE'] ?? 'unknown',
      uptime: process.uptime(),
      checks: {
        kora: { status: koraOk ? 'ok' : 'down' },
        facilitator: { status: facilitatorOk ? 'ok' : 'down' },
      },
    });
  });

  const port = Number(process.env['PORT'] ?? 3000);
  app.listen(port, () => console.info(`Relay gateway listening on :${port}`));
}

if (process.env['RUN_SERVER'] === '1') {
  await startServer();
}
