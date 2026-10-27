import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import {
  type PaymentTokenRegistry,
  type PlanRegistry,
  type SubscriptionSession,
  type PaymentQuote,
  type SubscriptionPlan,
  type PaymentToken,
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

export function createSubscriptionRouter(
  tokenRegistry: PaymentTokenRegistry,
  planRegistry: PlanRegistry,
): Router {
  const router = Router();

  // In-memory session store (persisted state in future phases)
  const sessions = new Map<string, SubscriptionSession>();
  const quotes = new Map<string, PaymentQuote>();

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
  router.post('/sessions', (req: Request, res: Response) => {
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

    sessions.set(sessionId, session);
    res.status(201).json(session);
  });

  // 4. Lifecycle: Request a quote for a session
  router.post('/sessions/:sessionId/quote', (req: Request, res: Response) => {
    const sessionId = Array.isArray(req.params['sessionId'])
      ? req.params['sessionId'][0]
      : req.params['sessionId'];
    if (!sessionId) {
      res.status(400).json({ error: 'Missing sessionId' });
      return;
    }
    const session = sessions.get(sessionId);

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
  router.post('/sessions/:sessionId/settle', (req: Request, res: Response) => {
    const sessionId = Array.isArray(req.params['sessionId'])
      ? req.params['sessionId'][0]
      : req.params['sessionId'];
    if (!sessionId) {
      res.status(400).json({ error: 'Missing sessionId' });
      return;
    }
    const session = sessions.get(sessionId);

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
      res.status(202).json({ status: 'pending_confirmation', session });
      return;
    }

    res.status(422).json({ error: settlementDecision.reason, session });
  });

  // 6. Inspect: Read session status
  router.get('/sessions/:sessionId', (req: Request, res: Response) => {
    const sessionId = Array.isArray(req.params['sessionId'])
      ? req.params['sessionId'][0]
      : req.params['sessionId'];
    if (!sessionId) {
      res.status(400).json({ error: 'Missing sessionId' });
      return;
    }
    const session = sessions.get(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json(session);
  });

  return router;
}
