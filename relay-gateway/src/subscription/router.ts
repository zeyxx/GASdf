import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import {
  type PaymentTokenRegistry,
  type PlanRegistry,
  type SubscriptionSession,
  type PaymentQuote,
  type SubscriptionPlan,
  type PaymentToken,
  type SessionStore,
  SessionStatus,
  SessionEvent,
  GASDF_SESSION_SCHEMA,
  GASDF_QUOTE_SCHEMA,
} from '../domain/subscription/types.js';
import {
  decideTokenAllowed,
  decideSubscriptionQuote,
  decideSessionTransition,
  decideSettlement,
} from '../domain/subscription/decision.js';
import { JupiterQuoteAdapter } from '../adapters/jupiter/quote-client.js';

export function createSubscriptionRouter(
  tokenRegistry: PaymentTokenRegistry,
  planRegistry: PlanRegistry,
  sessionStore: SessionStore,
  ledger?: { record: (entry: any) => void },
  jupQuoteAdapter: JupiterQuoteAdapter = new JupiterQuoteAdapter(),
): Router {
  const router = Router();

  // In-memory quote cache (TTL-driven)
  const quotes = new Map<string, PaymentQuote>();

  // Live dynamic quoting via Jupiter with TTL
  router.get('/quote/live', async (req: Request, res: Response) => {
    try {
      const tokenSymbol = (req.query['token'] as string)?.toUpperCase() ?? 'USDC';
      const planId = (req.query['planId'] as string) ?? 'pro-monthly';
      const token = tokenRegistry.tokens.find(
        (t) => t.symbol.toUpperCase() === tokenSymbol || t.mint === tokenSymbol,
      );

      if (!token || !token.enabled) {
        return res.status(400).json({ error: `Token ${tokenSymbol} not allowed or disabled` });
      }

      const plan = planRegistry.plans.find((p) => p.planId === planId);
      if (!plan || !plan.enabled) {
        return res.status(400).json({ error: `Plan ${planId} not found or disabled` });
      }

      const targetAsdfBaseUnits = BigInt(plan.priceAsdfBaseUnits);

      // Resolve SOL alias to Wrapped SOL mint for Jupiter routing
      const resolvedInputMint =
        token.mint === 'SOL' ? 'So11111111111111111111111111111111111111112' : token.mint;

      const decision = await jupQuoteAdapter.getLiveQuoteForAsdf({
        inputMint: resolvedInputMint,
        inputSymbol: token.symbol,
        inputDecimals: token.decimals,
        targetAsdfBaseUnits,
        slippageBps: token.slippageBpsDefault,
      });

      if (decision.status !== 'valid') {
        return res.status(422).json(decision);
      }

      res.json(decision);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown quote error' });
    }
  });

  // 1. Discovery: List available plans
  router.get('/plans', (_req: Request, res: Response) => {
    res.json({
      schema: planRegistry.schema,
      plans: planRegistry.plans.filter((p: SubscriptionPlan) => p.enabled),
    });
  });

  // 2. Discovery: List accepted payment tokens
  router.get('/tokens', (_req: Request, res: Response) => {
    res.json({
      schema: tokenRegistry.schema,
      tokens: tokenRegistry.tokens.filter((t: PaymentToken) => t.enabled),
      limits: tokenRegistry.limits,
    });
  });

  // 3. Lifecycle: Create a subscription session
  router.post('/sessions', async (req: Request, res: Response) => {
    const { appId, planId, buyerPubkey } = req.body ?? {};

    if (!appId || !planId || !buyerPubkey) {
      res.status(400).json({ error: 'Missing appId, planId, or buyerPubkey' });
      return;
    }

    const plan = planRegistry.plans.find((p: SubscriptionPlan) => p.appId === appId && p.planId === planId);
    if (!plan || !plan.enabled) {
      res.status(404).json({ error: 'Plan not found or disabled' });
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const ttl = tokenRegistry.limits.quoteTtlSeconds || 300;
    const sessionId = randomUUID();

    const session: SubscriptionSession = {
      schema: GASDF_SESSION_SCHEMA,
      sessionId,
      appId,
      planId,
      buyerPubkey,
      inputTokenMint: null,
      status: SessionStatus.Open,
      createdAt: now,
      expiresAt: now + ttl,
      settledAt: null,
    };

    await sessionStore.set(session);
    res.status(201).json(session);
  });

  // 4. Lifecycle: Request a quote for a session
  router.post('/sessions/:sessionId/quote', async (req: Request, res: Response) => {
    const sessionId = Array.isArray(req.params['sessionId'])
      ? req.params['sessionId'][0]
      : req.params['sessionId'];
    if (!sessionId) {
      res.status(400).json({ error: 'Missing sessionId' });
      return;
    }
    const session = await sessionStore.get(sessionId);

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const { inputTokenMint, inputAmount, estimatedAsdf, slippageBps } = req.body ?? {};
    if (!inputTokenMint || typeof inputAmount !== 'number' || typeof estimatedAsdf !== 'number') {
      res.status(400).json({ error: 'Missing inputTokenMint, inputAmount, or estimatedAsdf' });
      return;
    }

    const token = tokenRegistry.tokens.find((t: PaymentToken) => t.mint === inputTokenMint);
    if (!token) {
      res.status(400).json({ error: 'Token not accepted' });
      return;
    }

    const tokenDecision = decideTokenAllowed(tokenRegistry, inputTokenMint, inputAmount);
    if (tokenDecision !== 'allowed') {
      res.status(400).json({ error: `Token rejected: ${tokenDecision}` });
      return;
    }

    const plan = planRegistry.plans.find((p: SubscriptionPlan) => p.appId === session.appId && p.planId === session.planId);
    if (!plan) {
      res.status(500).json({ error: 'Plan associated with session no longer exists' });
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const quoteDecision = decideSubscriptionQuote(
      session,
      plan,
      token,
      inputAmount,
      estimatedAsdf,
      typeof slippageBps === 'number' ? slippageBps : null,
      now,
      true, // gasSponsored
    );

    if (quoteDecision.kind === 'reject') {
      res.status(422).json({ error: quoteDecision.reason });
      return;
    }

    // Transition session to Quoted
    const transition = decideSessionTransition(session, SessionEvent.QuoteRequested, now);
    if (transition.kind === 'to_quoted') {
      session.status = SessionStatus.Quoted;
      session.inputTokenMint = token.mint;
      await sessionStore.update(session.sessionId, session);
    }

    const quoteId = randomUUID();
    const quote: PaymentQuote = {
      schema: GASDF_QUOTE_SCHEMA,
      quoteId,
      sessionId,
      inputTokenMint: token.mint,
      inputAmount: quoteDecision.inputAmount,
      estimatedAsdf: quoteDecision.estimatedAsdf,
      slippageBps: quoteDecision.slippageBps,
      feesBaseUnits: 0,
      gasSponsored: quoteDecision.gasSponsored,
      expiresAt: session.expiresAt,
    };

    quotes.set(quoteId, quote);
    res.json({ quote, session });
  });

  // 5. Lifecycle: Settle session (confirm onchain payment)
  router.post('/sessions/:sessionId/settle', async (req: Request, res: Response) => {
    const sessionId = Array.isArray(req.params['sessionId'])
      ? req.params['sessionId'][0]
      : req.params['sessionId'];
    if (!sessionId) {
      res.status(400).json({ error: 'Missing sessionId' });
      return;
    }
    const session = await sessionStore.get(sessionId);

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const plan = planRegistry.plans.find((p: SubscriptionPlan) => p.appId === session.appId && p.planId === session.planId);
    if (!plan) {
      res.status(500).json({ error: 'Plan not found' });
      return;
    }

    const { receivedAsdf, confirmed } = req.body ?? {};
    if (typeof receivedAsdf !== 'number' || typeof confirmed !== 'boolean') {
      res.status(400).json({ error: 'Missing receivedAsdf or confirmed flag' });
      return;
    }

    const now = Math.floor(Date.now() / 1000);

    // If currently quoted and submission is confirmed, transition to pending first
    if (session.status === SessionStatus.Quoted) {
      const pendingTransition = decideSessionTransition(session, SessionEvent.PaymentSubmitted, now);
      if (pendingTransition.kind === 'to_pending') {
        session.status = SessionStatus.Pending;
      }
    }

    const settlementDecision = decideSettlement(
      session,
      receivedAsdf,
      plan.priceAsdfBaseUnits,
      confirmed,
      now,
    );

    if (settlementDecision.kind === 'settle') {
      const settleTransition = decideSessionTransition(
        session,
        SessionEvent.PaymentConfirmed,
        now,
        settlementDecision.settledAt,
      );
      if (settleTransition.kind === 'to_settled') {
        session.status = SessionStatus.Settled;
        session.settledAt = settleTransition.settledAt;
        await sessionStore.update(session.sessionId, session);
        if (ledger) {
          ledger.record({
            kind: 'subscription_settle',
            id: session.sessionId,
            amountTokenBaseUnits: receivedAsdf,
            metadata: {
              appId: session.appId,
              planId: session.planId,
              buyerPubkey: session.buyerPubkey,
              inputTokenMint: session.inputTokenMint,
            },
          });
        }
      }
      res.json({ status: 'settled', session });
      return;
    }

    if (settlementDecision.kind === 'shortfall') {
      res.status(400).json({
        error: 'Payment shortfall',
        received: settlementDecision.receivedAsdf,
        required: settlementDecision.requiredAsdf,
      });
      return;
    }

    if (settlementDecision.kind === 'pending_confirmation') {
      await sessionStore.update(session.sessionId, session);
      res.status(202).json({ status: 'pending_confirmation', session });
      return;
    }

    res.status(422).json({ error: settlementDecision.reason, session });
  });

  // 6. Inspect: Read session status
  router.get('/sessions/:sessionId', async (req: Request, res: Response) => {
    const sessionId = Array.isArray(req.params['sessionId'])
      ? req.params['sessionId'][0]
      : req.params['sessionId'];
    if (!sessionId) {
      res.status(400).json({ error: 'Missing sessionId' });
      return;
    }
    const session = await sessionStore.get(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json(session);
  });

  return router;
}
