// Background delivery worker (T3-014-B).
// Claims bounded batches of due work under a time-bounded lease.
// Work processing occurs completely outside any database transaction, guaranteeing
// that downstream dispatch and network calls never hold database transactions or locks.
import {
  DEFAULT_CLAIM_BATCH_SIZE,
  DEFAULT_LEASE_DURATION_MS,
  type ClaimOptions,
  type ClaimedDeliveryIntent,
  type CompleteOutcome,
  type ReleaseOutcome,
} from '../domain/delivery-intent.ts';

/** Port: the delivery-storage operations a worker needs. Infrastructure satisfies this structurally. */
export interface DeliveryIntentsPort {
  claimDueWork(options: ClaimOptions): Promise<ClaimedDeliveryIntent[]>;
  complete(id: string, workerId: string, now: Date): Promise<CompleteOutcome>;
  release(id: string, workerId: string): Promise<ReleaseOutcome>;
}

export type ProcessAction = 'complete' | 'release' | 'abandon';

export interface DeliveryWorkerOptions {
  readonly workerId: string;
  readonly intents: DeliveryIntentsPort;
  readonly batchSize?: number;
  readonly leaseDurationMs?: number;
}

export interface BatchProcessingResult {
  readonly claimed: number;
  readonly completed: number;
  readonly released: number;
  readonly abandoned: number;
}

export class DeliveryWorker {
  readonly workerId: string;
  readonly #intents: DeliveryIntentsPort;
  readonly #batchSize: number;
  readonly #leaseDurationMs: number;

  constructor(options: DeliveryWorkerOptions) {
    this.workerId = options.workerId;
    this.#intents = options.intents;
    this.#batchSize = options.batchSize ?? DEFAULT_CLAIM_BATCH_SIZE;
    this.#leaseDurationMs = options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
  }

  /**
   * Claims a bounded batch of due delivery work under a time-bounded lease.
   * Atomically acquires leases in PostgreSQL and immediately returns;
   * no transaction is held open during downstream processing.
   */
  async claimDue(now: Date): Promise<ClaimedDeliveryIntent[]> {
    return this.#intents.claimDueWork({
      workerId: this.workerId,
      now,
      batchSize: this.#batchSize,
      leaseDurationMs: this.#leaseDurationMs,
    });
  }

  /**
   * Processes one batch of due work using the supplied handler.
   * The handler is invoked for each intent outside any database transaction.
   * If a handler crashes or abandons the work, the lease remains active until
   * expiry, after which another worker recovers it.
   */
  async processBatch(
    now: Date,
    handler: (intent: ClaimedDeliveryIntent) => Promise<ProcessAction>,
  ): Promise<BatchProcessingResult> {
    const claimed = await this.claimDue(now);
    let completed = 0;
    let released = 0;
    let abandoned = 0;

    for (const intent of claimed) {
      try {
        const action = await handler(intent);
        if (action === 'complete') {
          const outcome = await this.#intents.complete(intent.id, this.workerId, now);
          if (outcome.status === 'completed') completed++;
          else abandoned++; // Lost lease before completing
        } else if (action === 'release') {
          const outcome = await this.#intents.release(intent.id, this.workerId);
          if (outcome.status === 'released') released++;
          else abandoned++;
        } else {
          abandoned++;
        }
      } catch {
        // Crash / unexpected exception: lease is abandoned and will recover at lease_expires_at
        abandoned++;
      }
    }

    return { claimed: claimed.length, completed, released, abandoned };
  }
}
