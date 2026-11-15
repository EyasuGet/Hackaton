// Background delivery worker (T3-014-B/C).
// Claims bounded batches of due work under a time-bounded lease (T3-014-B) and
// dispatches each intent through a channel adapter with bounded retries and
// safe handling of unknown outcomes (T3-014-C).
// Work processing occurs completely outside any database transaction.
import {
  DEFAULT_CLAIM_BATCH_SIZE,
  DEFAULT_LEASE_DURATION_MS,
  MAX_ATTEMPT_COUNT,
  type ClaimOptions,
  type ClaimedDeliveryIntent,
  type CompleteOutcome,
  type DispatchOutcome,
  type FailOutcome,
  type MarkUncertainOutcome,
  type ReleaseOutcome,
} from '../domain/delivery-intent.ts';

/** Port: the delivery-storage operations a worker needs. Infrastructure satisfies this structurally. */
export interface DeliveryIntentsPort {
  claimDueWork(options: ClaimOptions): Promise<ClaimedDeliveryIntent[]>;
  complete(id: string, workerId: string, now: Date): Promise<CompleteOutcome>;
  release(id: string, workerId: string): Promise<ReleaseOutcome>;
  fail(id: string, workerId: string, now: Date): Promise<FailOutcome>;
  markUncertain(id: string, workerId: string): Promise<MarkUncertainOutcome>;
}

/** Port: a channel adapter that attempts to send a claimed intent. */
export interface DispatchPort {
  dispatch(intent: ClaimedDeliveryIntent): Promise<DispatchOutcome>;
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

export interface DispatchBatchResult {
  readonly claimed: number;
  /** Successfully sent and completed. */
  readonly sent: number;
  /** Adapter reported a definitive failure. */
  readonly failed: number;
  /** Outcome unknown after dispatch attempt (network error or adapter uncertainty). */
  readonly uncertain: number;
  /** Exceeded max attempts without dispatch; permanently failed. */
  readonly exceeded: number;
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

  /**
   * Claims due work and dispatches each intent through the supplied channel adapter.
   * - Exceeded-attempt intents are marked failed without dispatch.
   * - A thrown adapter error is treated as uncertain (message may or may not have been sent).
   * - Each dispatch call runs outside any database transaction.
   */
  async dispatchBatch(now: Date, dispatchPort: DispatchPort): Promise<DispatchBatchResult> {
    const claimed = await this.claimDue(now);
    let sent = 0;
    let failed = 0;
    let uncertain = 0;
    let exceeded = 0;

    for (const intent of claimed) {
      if (intent.attemptCount > MAX_ATTEMPT_COUNT) {
        await this.#intents.fail(intent.id, this.workerId, now);
        exceeded++;
        continue;
      }

      let outcome: DispatchOutcome;
      try {
        outcome = await dispatchPort.dispatch(intent);
      } catch {
        // Adapter threw: we cannot confirm delivery; record as uncertain so the
        // record is preserved for audit rather than silently abandoned.
        await this.#intents.markUncertain(intent.id, this.workerId);
        uncertain++;
        continue;
      }

      if (outcome.status === 'sent') {
        await this.#intents.complete(intent.id, this.workerId, now);
        sent++;
      } else if (outcome.status === 'failed') {
        await this.#intents.fail(intent.id, this.workerId, now);
        failed++;
      } else {
        await this.#intents.markUncertain(intent.id, this.workerId);
        uncertain++;
      }
    }

    return { claimed: claimed.length, sent, failed, uncertain, exceeded };
  }
}
