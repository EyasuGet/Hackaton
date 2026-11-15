import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { principalOf, requireRole } from '../../../identity/presentation/http/authentication.ts';
import {
  CareerResearchError,
  type CareerResearchService,
} from '../../application/career-research.ts';
import type { JobAnswers } from '../../application/job-answers.ts';
import type { JobPreferences } from '../../application/job-preferences.ts';
import type { JobRepository } from '../../application/import-jobs.ts';

export function registerCareersRoutes(
  app: FastifyInstance,
  authenticated: preHandlerAsyncHookHandler,
  jobRepository: JobRepository,
  jobPreferences?: JobPreferences,
  jobAnswers?: JobAnswers,
  careerResearch?: CareerResearchService,
) {
  const learnerOnly = { preHandler: [authenticated, requireRole('learner')] };

  // Lists active approved jobs for learner job selection (accommodation request flow).
  app.get('/api/jobs', learnerOnly, async () => {
    const jobs = await jobRepository.listJobs({ status: 'active' });
    return {
      jobs: jobs.map(({ id, title, organization, category, location, sourceUrl }) => ({
        id,
        title,
        organization,
        category,
        location,
        sourceUrl,
      })),
    };
  });

  if (jobPreferences) {
    // Lists subscriptions owned by the requesting learner.
    app.get('/api/careers/subscriptions', learnerOnly, async (request) => {
      const principal = principalOf(request);
      const subscriptions = await jobPreferences.listOwned(principal);
      return { subscriptions };
    });

    // Subscribes a learner to category/location-filtered alerts.
    app.post<{
      Body: {
        channel?: string;
        destination?: string;
        categories?: string[];
        locations?: string[];
      };
    }>('/api/careers/subscriptions', learnerOnly, async (request, reply) => {
      const { channel, destination, categories, locations } = request.body ?? {};
      if (typeof channel !== 'string') {
        return reply.code(400).send({ error: 'channel is required' });
      }
      if (channel.toLowerCase() !== 'telegram' && typeof destination !== 'string') {
        return reply.code(400).send({ error: 'channel and destination are required' });
      }
      const principal = principalOf(request);
      const subscription = await jobPreferences.subscribe(principal, {
        channel,
        destination: destination ?? '',
        categories: Array.isArray(categories) ? categories : [],
        locations: Array.isArray(locations) ? locations : [],
      });
      if (!subscription) {
        return reply.code(400).send({ error: 'invalid_subscription' });
      }
      return reply.code(201).send({ subscription });
    });

    // Unsubscribes an owned alert subscription, cancelling queued intents and pruning unused contact.
    app.delete<{
      Params: { id: string };
    }>('/api/careers/subscriptions/:id', learnerOnly, async (request, reply) => {
      const principal = principalOf(request);
      const outcome = await jobPreferences.unsubscribe(principal, request.params.id);
      if (!outcome) {
        return reply.code(404).send({ error: 'subscription_not_found' });
      }
      return reply.code(200).send({
        status: 'unsubscribed',
        subscription: outcome.subscription,
        cancelledIntentsCount: outcome.cancelledIntentsCount,
        contactRemoved: outcome.contactRemoved,
      });
    });
  }

  if (jobAnswers) {
    // Answers learner questions grounded in approved job records (T3-019-B).
    app.post<{
      Body: { question?: string };
    }>('/api/careers/answers', learnerOnly, async (request, reply) => {
      const { question } = request.body ?? {};
      if (!question || typeof question !== 'string' || question.trim() === '') {
        return reply.code(400).send({ error: 'invalid_question' });
      }
      const principal = principalOf(request);
      const result = await jobAnswers.answer(principal, question.trim());
      return reply.code(200).send(result);
    });
  }

  if (careerResearch) {
    // Supplementary external career web research with explicit consent (T3-028-A).
    app.post<{
      Body: {
        query?: string;
        consent?: boolean;
        language?: 'en' | 'am';
        limit?: number;
      };
    }>('/api/careers/research', learnerOnly, async (request, reply) => {
      const { query, consent, language, limit } = request.body ?? {};
      if (typeof query !== 'string' || query.trim() === '') {
        return reply.code(400).send({ error: 'invalid_query', message: 'Query is required.' });
      }
      if (consent !== true) {
        return reply
          .code(400)
          .send({ error: 'consent_required', message: 'Explicit consent is required.' });
      }

      try {
        const principal = principalOf(request);
        const result = await careerResearch.research(principal, {
          query: query.trim(),
          consent: true,
          language,
          limit,
        });
        return reply.code(200).send(result);
      } catch (error) {
        if (error instanceof CareerResearchError) {
          if (error.code === 'consent_required' || error.code === 'invalid_query') {
            return reply.code(400).send({ error: error.code, message: error.message });
          }
          if (error.code === 'unauthorized') {
            return reply.code(403).send({ error: 'forbidden', message: error.message });
          }
          if (error.code === 'rate_limited') {
            if (error.retryAfterSeconds) {
              reply.header('Retry-After', error.retryAfterSeconds);
            }
            return reply.code(429).send({
              error: 'rate_limited',
              message: error.message,
              retryAfterSeconds: error.retryAfterSeconds,
            });
          }
          if (error.code === 'provider_unavailable') {
            return reply.code(503).send({ error: 'provider_unavailable', message: error.message });
          }
        }
        throw error;
      }
    });
  }
}
