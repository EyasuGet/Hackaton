// Employer HTTP presentation routes (T3-031).
// Enforces:
// 1. Bearer authentication with 'employer' role required.
// 2. Strict isolation: employers cannot access any learner tutoring, accommodation, or chat.
// 3. Consented applications only: employers only see applicants who explicitly submitted.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ResolvePrincipal } from '../../../identity/application/resolve-principal.ts';
import {
  authenticate,
  principalOf,
  requireRole,
} from '../../../identity/presentation/http/authentication.ts';
import type { EmployerService } from '../../application/employer-service.ts';

interface PostVacancyBody {
  title: string;
  description: string;
  category?: string;
  location?: string;
  expiresDays?: number;
}

export function registerEmployerRoutes(
  app: FastifyInstance,
  employerService: EmployerService,
  resolvePrincipal: ResolvePrincipal,
) {
  // Prehandlers for employer endpoints
  const employerAuth = [authenticate(resolvePrincipal), requireRole('employer')];

  // POST /api/employer/vacancies — Post new vacancy
  app.post<{ Body: PostVacancyBody }>(
    '/api/employer/vacancies',
    { preHandler: employerAuth },
    async (request: FastifyRequest<{ Body: PostVacancyBody }>, reply: FastifyReply) => {
      const principal = principalOf(request);
      const { title, description, category, location, expiresDays } = request.body ?? {};

      if (!title || !description) {
        return reply.code(400).send({ error: 'title and description are required' });
      }

      const vacancy = await employerService.postVacancy(principal.id, {
        title,
        description,
        category: category || 'General',
        location: location || 'Addis Ababa',
        expiresDays,
      });

      return reply.code(201).send(vacancy);
    },
  );

  // GET /api/employer/vacancies — List employer's vacancies
  app.get(
    '/api/employer/vacancies',
    { preHandler: employerAuth },
    async (request: FastifyRequest) => {
      const principal = principalOf(request);
      const vacancies = await employerService.getVacancies(principal.id);
      return { vacancies };
    },
  );

  // GET /api/employer/vacancies/:id/applications — List consented applications
  app.get<{ Params: { id: string } }>(
    '/api/employer/vacancies/:id/applications',
    { preHandler: employerAuth },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const principal = principalOf(request);
      const { id } = request.params;

      const applications = await employerService.getApplications(principal.id, id);
      if (applications === null) {
        return reply.code(404).send({ error: 'vacancy not found' });
      }

      return {
        vacancyId: id,
        applications,
        privacyNotice: 'Applications are presented under explicit candidate consent.',
      };
    },
  );
}
