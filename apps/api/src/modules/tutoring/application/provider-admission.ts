// Bounded provider admission controller and rate limiter (T3-024-C).
// Enforces configured shared and per-learner rate limits, bounded concurrency admission,
// per-user fairness, and input size bounds across answer and speech invocations.
// Guarantees immediate capacity release on completion, failure, timeout, and cancellation.

import {
  DEFAULT_PROVIDER_LIMITS,
  type ProviderLimitsConfig,
} from '../../../bootstrap/config.ts';

export type AdmissionErrorCode = 'busy' | 'rate_limited' | 'input_too_large' | 'timeout';

export class ProviderAdmissionError extends Error {
  readonly code: AdmissionErrorCode;
  readonly retryAfterSeconds?: number;

  constructor(code: AdmissionErrorCode, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = 'ProviderAdmissionError';
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface AdmissionLease {
  /** Releases the concurrency slot back to the admission controller. Idempotent. */
  release(): void;
}

interface QueueItem {
  readonly id: string;
  readonly learnerId: string;
  readonly createdAt: number;
  readonly resolve: (lease: AdmissionLease) => void;
  readonly reject: (error: Error) => void;
  timer?: NodeJS.Timeout | undefined;
  signal?: AbortSignal | undefined;
  onAbort?: (() => void) | undefined;
}

export class ProviderAdmissionController {
  readonly limits: ProviderLimitsConfig;
  readonly #activePerLearner = new Map<string, number>();
  readonly #queue: QueueItem[] = [];
  readonly #globalRateTimestamps: number[] = [];
  readonly #learnerRateTimestamps = new Map<string, number[]>();
  #activeTotal = 0;
  #queueCounter = 0;

  constructor(limits: Partial<ProviderLimitsConfig> = {}) {
    this.limits = {
      ...DEFAULT_PROVIDER_LIMITS,
      ...limits,
    };
  }

  get activeCount(): number {
    return this.#activeTotal;
  }

  get queueLength(): number {
    return this.#queue.length;
  }

  getActiveCountForLearner(learnerId: string): number {
    return this.#activePerLearner.get(learnerId) ?? 0;
  }

  getQueueCountForLearner(learnerId: string): number {
    return this.#queue.filter((item) => item.learnerId === learnerId).length;
  }

  /**
   * Validates question input character length against configured maximum.
   * Throws ProviderAdmissionError with 'input_too_large' when exceeded.
   */
  assertQuestionSize(question: string): void {
    if (question.length > this.limits.maxQuestionLength) {
      throw new ProviderAdmissionError(
        'input_too_large',
        `Question exceeds maximum allowed length of ${this.limits.maxQuestionLength} characters (received ${question.length})`,
      );
    }
  }

  /**
   * Validates speech input text character length against configured maximum.
   * Throws ProviderAdmissionError with 'input_too_large' when exceeded.
   */
  assertSpeechTextSize(text: string): void {
    if (text.length > this.limits.maxSpeechTextLength) {
      throw new ProviderAdmissionError(
        'input_too_large',
        `Speech text exceeds maximum allowed length of ${this.limits.maxSpeechTextLength} characters (received ${text.length})`,
      );
    }
  }

  /**
   * Evaluates rate limits using a sliding window. Throws ProviderAdmissionError
   * with code 'rate_limited' and a positive retryAfterSeconds when saturated.
   */
  #checkAndRecordRateLimit(learnerId: string, now: number): void {
    const windowStart = now - this.limits.rateLimitWindowMs;

    // 1. Prune expired global timestamps
    while (
      this.#globalRateTimestamps.length > 0 &&
      this.#globalRateTimestamps[0]! <= windowStart
    ) {
      this.#globalRateTimestamps.shift();
    }

    // 2. Check global rate limit
    if (this.#globalRateTimestamps.length >= this.limits.rateLimitMaxRequests) {
      const oldest = this.#globalRateTimestamps[0]!;
      const retryAfter = Math.max(1, Math.ceil((oldest + this.limits.rateLimitWindowMs - now) / 1000));
      throw new ProviderAdmissionError(
        'rate_limited',
        'Global provider rate limit reached. Please wait before submitting more requests.',
        retryAfter,
      );
    }

    // 3. Prune expired learner timestamps
    const learnerTimestamps = this.#learnerRateTimestamps.get(learnerId) ?? [];
    const prunedLearnerTimestamps = learnerTimestamps.filter((ts) => ts > windowStart);
    if (prunedLearnerTimestamps.length === 0) {
      this.#learnerRateTimestamps.delete(learnerId);
    } else {
      this.#learnerRateTimestamps.set(learnerId, prunedLearnerTimestamps);
    }

    // 4. Check per-learner rate limit
    if (prunedLearnerTimestamps.length >= this.limits.rateLimitPerLearnerMaxRequests) {
      const oldest = prunedLearnerTimestamps[0]!;
      const retryAfter = Math.max(1, Math.ceil((oldest + this.limits.rateLimitWindowMs - now) / 1000));
      throw new ProviderAdmissionError(
        'rate_limited',
        'Learner rate limit reached. Please wait before submitting more requests.',
        retryAfter,
      );
    }

    // 5. Record this request timestamp
    this.#globalRateTimestamps.push(now);
    prunedLearnerTimestamps.push(now);
    this.#learnerRateTimestamps.set(learnerId, prunedLearnerTimestamps);
  }

  /**
   * Acquires a concurrency lease for an external provider invocation.
   * Respects global concurrency, per-learner fairness caps, queue depth bounds,
   * queue timeout, and client cancellation.
   */
  async acquire(learnerId: string, signal?: AbortSignal): Promise<AdmissionLease> {
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new Error('Request was aborted');
    }

    const now = Date.now();
    this.#checkAndRecordRateLimit(learnerId, now);

    const learnerActive = this.#activePerLearner.get(learnerId) ?? 0;
    // An arriving request can run immediately if capacity is available and no waiting
    // queue item is already eligible for that slot (fair FIFO).
    const hasEligibleQueuedItem = this.#queue.some(
      (item) =>
        (this.#activePerLearner.get(item.learnerId) ?? 0) <
        this.limits.maxPerLearnerConcurrency,
    );

    const canRunImmediately =
      this.#activeTotal < this.limits.maxConcurrency &&
      learnerActive < this.limits.maxPerLearnerConcurrency &&
      !hasEligibleQueuedItem;

    if (canRunImmediately) {
      this.#activeTotal++;
      this.#activePerLearner.set(learnerId, learnerActive + 1);
      return this.#createLease(learnerId);
    }

    // Cannot run immediately: inspect queue bounds and fairness limits
    if (this.#queue.length >= this.limits.maxQueueSize) {
      throw new ProviderAdmissionError(
        'busy',
        'Assistant provider capacity is currently saturated. Please try again in a moment.',
        3,
      );
    }

    const learnerQueued = this.getQueueCountForLearner(learnerId);
    if (learnerQueued >= this.limits.maxPerLearnerQueue) {
      throw new ProviderAdmissionError(
        'busy',
        'You have concurrent requests already awaiting provider capacity. Please wait for them to finish.',
        3,
      );
    }

    // Enqueue with timeout and cancellation hooks
    return new Promise<AdmissionLease>((resolve, reject) => {
      const queueId = `q-${Date.now()}-${++this.#queueCounter}`;
      const item: QueueItem = {
        id: queueId,
        learnerId,
        createdAt: Date.now(),
        resolve,
        reject,
        signal,
      };

      const removeFromQueue = () => {
        const index = this.#queue.findIndex((q) => q.id === queueId);
        if (index !== -1) {
          this.#queue.splice(index, 1);
        }
      };

      // 1. Queue wait timeout
      item.timer = setTimeout(() => {
        removeFromQueue();
        if (item.signal && item.onAbort) {
          item.signal.removeEventListener('abort', item.onAbort);
        }
        reject(
          new ProviderAdmissionError(
            'busy',
            'Request timed out waiting for an available provider slot. Please retry.',
            3,
          ),
        );
      }, this.limits.queueTimeoutMs);

      // 2. Cancellation handling
      if (signal) {
        item.onAbort = () => {
          removeFromQueue();
          if (item.timer) clearTimeout(item.timer);
          reject(signal.reason instanceof Error ? signal.reason : new Error('Request cancelled'));
        };
        signal.addEventListener('abort', item.onAbort, { once: true });
      }

      this.#queue.push(item);
      this.#dequeueNext();
    });
  }

  /**
   * Executes a task under provider admission, ensuring capacity is released
   * unconditionally when finished, failed, timed out, or aborted.
   */
  async execute<T>(
    learnerId: string,
    task: (signal?: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const lease = await this.acquire(learnerId, signal);
    try {
      return await task(signal);
    } finally {
      lease.release();
    }
  }

  #createLease(learnerId: string): AdmissionLease {
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.#release(learnerId);
      },
    };
  }

  #release(learnerId: string): void {
    if (this.#activeTotal > 0) {
      this.#activeTotal--;
    }
    const current = this.#activePerLearner.get(learnerId) ?? 1;
    if (current <= 1) {
      this.#activePerLearner.delete(learnerId);
    } else {
      this.#activePerLearner.set(learnerId, current - 1);
    }

    this.#dequeueNext();
  }

  /**
   * Dequeues the next eligible request respecting per-learner concurrency fairness.
   */
  #dequeueNext(): void {
    if (this.#activeTotal >= this.limits.maxConcurrency || this.#queue.length === 0) {
      return;
    }

    // Find the first waiting item whose learner has not exceeded their active cap (fair scheduling)
    const index = this.#queue.findIndex((item) => {
      const active = this.#activePerLearner.get(item.learnerId) ?? 0;
      return active < this.limits.maxPerLearnerConcurrency;
    });

    if (index === -1) {
      // All queued items belong to learners already at their per-learner concurrency cap
      return;
    }

    const [item] = this.#queue.splice(index, 1);
    if (!item) return;

    if (item.timer) clearTimeout(item.timer);
    if (item.signal && item.onAbort) {
      item.signal.removeEventListener('abort', item.onAbort);
    }

    this.#activeTotal++;
    const learnerActive = this.#activePerLearner.get(item.learnerId) ?? 0;
    this.#activePerLearner.set(item.learnerId, learnerActive + 1);

    item.resolve(this.#createLease(item.learnerId));
  }
}
