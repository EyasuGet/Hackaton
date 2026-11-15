// Unit tests for ProviderAdmissionController (T3-024-C).
// Proves bounded provider admission, fair queuing, timeout/failure/cancellation
// capacity release, sliding-window rate limits, and input size constraints
// without live-provider costs.

import { describe, expect, it } from 'vitest';
import { ProviderAdmissionController, ProviderAdmissionError } from './provider-admission.ts';

describe('ProviderAdmissionController (T3-024-C)', () => {
  describe('Input size bounds', () => {
    it('accepts question inputs within limits and rejects oversized questions', () => {
      const controller = new ProviderAdmissionController({ maxQuestionLength: 50 });
      expect(() => controller.assertQuestionSize('Short question?')).not.toThrow();

      const oversized = 'A'.repeat(51);
      expect(() => controller.assertQuestionSize(oversized)).toThrow(ProviderAdmissionError);
      expect(() => controller.assertQuestionSize(oversized)).toThrow(
        'exceeds maximum allowed length',
      );
    });

    it('accepts speech text within limits and rejects oversized speech inputs', () => {
      const controller = new ProviderAdmissionController({ maxSpeechTextLength: 60 });
      expect(() => controller.assertSpeechTextSize('Short answer to read aloud.')).not.toThrow();

      const oversized = 'B'.repeat(61);
      expect(() => controller.assertSpeechTextSize(oversized)).toThrow(ProviderAdmissionError);
      expect(() => controller.assertSpeechTextSize(oversized)).toThrow(
        'exceeds maximum allowed length',
      );
    });
  });

  describe('Bounded concurrency and capacity release', () => {
    it('admits requests up to maxConcurrency and releases capacity on completion', async () => {
      const controller = new ProviderAdmissionController({
        maxConcurrency: 2,
        maxPerLearnerConcurrency: 2,
        maxQueueSize: 2,
      });

      const lease1 = await controller.acquire('learner-1');
      const lease2 = await controller.acquire('learner-2');

      expect(controller.activeCount).toBe(2);

      // Third request is queued because maxConcurrency is 2
      let lease3Resolved = false;
      const promise3 = controller.acquire('learner-3').then((lease) => {
        lease3Resolved = true;
        return lease;
      });

      expect(controller.queueLength).toBe(1);
      expect(lease3Resolved).toBe(false);

      // Releasing lease1 frees capacity and admits queued learner-3
      lease1.release();
      const lease3 = await promise3;

      expect(lease3Resolved).toBe(true);
      expect(controller.activeCount).toBe(2);
      expect(controller.queueLength).toBe(0);

      lease2.release();
      lease3.release();
      expect(controller.activeCount).toBe(0);
    });

    it('releases capacity when an operation fails (throws)', async () => {
      const controller = new ProviderAdmissionController({
        maxConcurrency: 1,
        maxPerLearnerConcurrency: 1,
        maxQueueSize: 2,
      });

      // Execute a failing task
      await expect(
        controller.execute('learner-1', () => {
          expect(controller.activeCount).toBe(1);
          return Promise.reject(new Error('Synthetic provider breakdown'));
        }),
      ).rejects.toThrow('Synthetic provider breakdown');

      // Slot must be completely released despite the exception
      expect(controller.activeCount).toBe(0);

      // Subsequent request can acquire immediately
      const result = await controller.execute('learner-1', () => Promise.resolve('recovered'));
      expect(result).toBe('recovered');
      expect(controller.activeCount).toBe(0);
    });

    it('rejects immediately with busy when queue capacity is saturated', async () => {
      const controller = new ProviderAdmissionController({
        maxConcurrency: 1,
        maxPerLearnerConcurrency: 1,
        maxQueueSize: 1,
        maxPerLearnerQueue: 1,
      });

      const lease1 = await controller.acquire('learner-1');
      expect(controller.activeCount).toBe(1);

      // Queue 1 item (maxQueueSize is 1)
      const promise2 = controller.acquire('learner-2');
      expect(controller.queueLength).toBe(1);

      // Next request exceeds queue size -> immediate rejection
      await expect(controller.acquire('learner-3')).rejects.toThrow(ProviderAdmissionError);
      try {
        await controller.acquire('learner-3');
      } catch (err) {
        expect(err).toBeInstanceOf(ProviderAdmissionError);
        expect((err as ProviderAdmissionError).code).toBe('busy');
        expect((err as ProviderAdmissionError).retryAfterSeconds).toBeGreaterThan(0);
      }

      lease1.release();
      const lease2 = await promise2;
      lease2.release();
    });

    it('times out and releases queue slot when queue wait exceeds queueTimeoutMs', async () => {
      const controller = new ProviderAdmissionController({
        maxConcurrency: 1,
        maxPerLearnerConcurrency: 1,
        maxQueueSize: 2,
        queueTimeoutMs: 50,
      });

      const lease1 = await controller.acquire('learner-1');

      // Queued request waits beyond 50ms timeout
      await expect(controller.acquire('learner-2')).rejects.toThrow(
        /Request timed out waiting for an available provider slot/i,
      );

      // Queue slot is cleaned up
      expect(controller.queueLength).toBe(0);

      lease1.release();
      expect(controller.activeCount).toBe(0);
    });

    it('cleans up queue slot when request is cancelled/aborted while waiting', async () => {
      const controller = new ProviderAdmissionController({
        maxConcurrency: 1,
        maxPerLearnerConcurrency: 1,
        maxQueueSize: 2,
        queueTimeoutMs: 10000,
      });

      const lease1 = await controller.acquire('learner-1');

      const abortController = new AbortController();
      const promise = controller.acquire('learner-2', abortController.signal);

      expect(controller.queueLength).toBe(1);

      // Abort while queued
      abortController.abort(new Error('User left page'));

      await expect(promise).rejects.toThrow('User left page');
      expect(controller.queueLength).toBe(0);

      lease1.release();
      expect(controller.activeCount).toBe(0);
    });

    it('releases capacity when an executing operation is cancelled', async () => {
      const controller = new ProviderAdmissionController({
        maxConcurrency: 1,
        maxPerLearnerConcurrency: 1,
      });

      const abortController = new AbortController();

      const executePromise = controller.execute(
        'learner-1',
        async (signal) => {
          expect(controller.activeCount).toBe(1);
          if (signal?.aborted) {
            throw new Error('Operation aborted');
          }
          return new Promise<string>((_, reject) => {
            signal?.addEventListener('abort', () => reject(new Error('Operation aborted')));
          });
        },
        abortController.signal,
      );

      // Yield a tick so execute starts running
      await new Promise((r) => setTimeout(r, 5));
      abortController.abort();
      await expect(executePromise).rejects.toThrow('Operation aborted');

      // Active slot is freed
      expect(controller.activeCount).toBe(0);
    });
  });

  describe('Per-user fairness', () => {
    it('prevents one learner from monopolizing concurrency slots when others need capacity', async () => {
      const controller = new ProviderAdmissionController({
        maxConcurrency: 4,
        maxPerLearnerConcurrency: 2,
        maxQueueSize: 5,
        maxPerLearnerQueue: 2,
      });

      // Learner A acquires 2 slots (their max allowance)
      const leaseA1 = await controller.acquire('learner-A');
      const leaseA2 = await controller.acquire('learner-A');
      expect(controller.activeCount).toBe(2);

      // Learner A attempts a 3rd request -> queued because Learner A reached maxPerLearnerConcurrency
      let leaseA3Resolved = false;
      const promiseA3 = controller.acquire('learner-A').then((l) => {
        leaseA3Resolved = true;
        return l;
      });

      expect(controller.queueLength).toBe(1);
      expect(leaseA3Resolved).toBe(false);

      // Learner B arrives with 0 active slots:
      // Even though total active is 2 (< 4) and Learner A has a queued item,
      // Learner B can run immediately because Learner B has not exceeded per-user cap!
      const leaseB1 = await controller.acquire('learner-B');
      expect(controller.activeCount).toBe(3);
      expect(controller.getActiveCountForLearner('learner-B')).toBe(1);

      // Learner A's queued request is still waiting for Learner A's slot
      expect(leaseA3Resolved).toBe(false);

      // Once Learner A releases one slot, Learner A3 is admitted
      leaseA1.release();
      const leaseA3 = await promiseA3;
      expect(leaseA3Resolved).toBe(true);
      expect(controller.getActiveCountForLearner('learner-A')).toBe(2);

      leaseA2.release();
      leaseA3.release();
      leaseB1.release();
      expect(controller.activeCount).toBe(0);
    });

    it('enforces per-learner queue bounds so one learner cannot flood the waiting queue', async () => {
      const controller = new ProviderAdmissionController({
        maxConcurrency: 1,
        maxPerLearnerConcurrency: 1,
        maxQueueSize: 5,
        maxPerLearnerQueue: 1,
      });

      const lease1 = await controller.acquire('learner-A');

      // Learner A queues 1 item
      const promiseA2 = controller.acquire('learner-A');
      expect(controller.getQueueCountForLearner('learner-A')).toBe(1);

      // Learner A attempts another queued request -> rejected for exceeding per-learner queue limit
      await expect(controller.acquire('learner-A')).rejects.toThrow(
        /You have concurrent requests already awaiting provider capacity/i,
      );

      // Meanwhile, Learner B can still queue an item because Learner B has 0 queued!
      const promiseB1 = controller.acquire('learner-B');
      expect(controller.getQueueCountForLearner('learner-B')).toBe(1);

      lease1.release();
      const leaseA2 = await promiseA2;
      leaseA2.release();
      const leaseB1 = await promiseB1;
      leaseB1.release();
    });
  });

  describe('Sliding-window rate limits', () => {
    it('enforces per-learner rate limits with truthful retryAfterSeconds', async () => {
      const controller = new ProviderAdmissionController({
        maxConcurrency: 10,
        maxPerLearnerConcurrency: 10,
        rateLimitWindowMs: 10000,
        rateLimitPerLearnerMaxRequests: 2,
        rateLimitMaxRequests: 10,
      });

      const lease1 = await controller.acquire('learner-1');
      lease1.release();

      const lease2 = await controller.acquire('learner-1');
      lease2.release();

      // Third request within window exceeds rate limit
      try {
        await controller.acquire('learner-1');
        expect.unreachable('Should have thrown rate limit error');
      } catch (err) {
        expect(err).toBeInstanceOf(ProviderAdmissionError);
        const admissionErr = err as ProviderAdmissionError;
        expect(admissionErr.code).toBe('rate_limited');
        expect(admissionErr.retryAfterSeconds).toBeGreaterThan(0);
      }

      // But learner-2 is not rate-limited!
      const leaseLearner2 = await controller.acquire('learner-2');
      expect(leaseLearner2).toBeDefined();
      leaseLearner2.release();
    });

    it('enforces global shared rate limits across all learners', async () => {
      const controller = new ProviderAdmissionController({
        maxConcurrency: 10,
        maxPerLearnerConcurrency: 10,
        rateLimitWindowMs: 10000,
        rateLimitPerLearnerMaxRequests: 10,
        rateLimitMaxRequests: 2,
      });

      const lease1 = await controller.acquire('learner-1');
      lease1.release();

      const lease2 = await controller.acquire('learner-2');
      lease2.release();

      // Third request exceeds global limit even from new learner-3
      await expect(controller.acquire('learner-3')).rejects.toThrow(
        /Global provider rate limit reached/i,
      );
    });
  });
});
