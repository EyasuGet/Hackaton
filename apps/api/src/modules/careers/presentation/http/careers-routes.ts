// HTTP presentation routes for career job listings (T3-022-A).
// Authenticated learners may browse active approved jobs to select one for an
// accommodation request. No personal data or course-restricted content is exposed.
import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { requireRole } from '../../../identity/presentation/http/authentication.ts';
import type { JobRepository } from '../../application/import-jobs.ts';

export function registerCareersRoutes(
  app: FastifyInstance,
  authenticated: preHandlerAsyncHookHandler,
  jobRepository: JobRepository,
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
}
