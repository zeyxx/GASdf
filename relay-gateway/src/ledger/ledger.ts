import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface LedgerEntry {
  timestamp: string;
  kind: 'relay_x402' | 'subscription_settle' | 'batch_burn';
  id: string; // signature, sessionId or uuid
  amountLamports?: number;
  amountTokenBaseUnits?: number;
  tokenMint?: string;
  usdValueApprox?: number;
  network?: string;
  metadata?: Record<string, unknown>;
}

export class LedgerService {
  private filePath: string;

  constructor(filePath: string = 'data/ledger.jsonl') {
    this.filePath = filePath;
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
    } catch {
      // Ignore if directory already exists
    }
  }

  record(entry: Omit<LedgerEntry, 'timestamp'>): void {
    const fullEntry: LedgerEntry = {
      timestamp: new Date().toISOString(),
      ...entry,
    };
    try {
      appendFileSync(this.filePath, `${JSON.stringify(fullEntry)}\n`, 'utf8');
    } catch (err) {
      console.error('[LedgerService] Failed to write ledger entry:', err);
    }
  }
}
