// PostgreSQL adapter for tutoring persistence. Applies owner and course scope
// to all reads and writes so ungranted or other-learner records cannot be seen.
import type pg from 'pg';
import type { OwnedScope } from '../../../identity/domain/principal.ts';
import type {
  ClaimRequestInput,
  ClaimResult,
  RecordOutcomeInput,
  TutoringRepository,
} from '../../application/ports/tutoring-repository.ts';
import type { TutoringConversation } from '../../domain/conversation.ts';
import type { TutoringRequest, TutoringRequestState } from '../../domain/tutoring-request.ts';

const IN_SCOPE = 'owner_id = $1 AND course_id = ANY($2::text[])';

interface ConversationRow {
  id: string;
  owner_id: string;
  course_id: string;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
  purged_at: Date | null;
}

function toConversation(row: ConversationRow): TutoringConversation {
  return {
    id: row.id,
    ownerId: row.owner_id,
    courseId: row.course_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    purgedAt: row.purged_at ? row.purged_at.toISOString() : null,
  };
}

interface RequestRow {
  id: string;
  conversation_id: string;
  owner_id: string;
  course_id: string;
  request_id: string;
  question: string;
  state: TutoringRequestState;
  answer_text: string | null;
  answer_lang: string | null;
  error_reason: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
  expires_at: Date;
  purged_at: Date | null;
}

function toRequest(row: RequestRow): TutoringRequest {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    ownerId: row.owner_id,
    courseId: row.course_id,
    requestId: row.request_id,
    question: row.question,
    state: row.state,
    answerText: row.answer_text,
    answerLang: row.answer_lang,
    errorReason: row.error_reason,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
    expiresAt: row.expires_at.toISOString(),
    purgedAt: row.purged_at ? row.purged_at.toISOString() : null,
  };
}

const REQUEST_SELECT = `
  SELECT id, conversation_id, owner_id, course_id, request_id, question, state,
         answer_text, answer_lang, error_reason, created_at, updated_at, completed_at,
         expires_at, purged_at
  FROM tutoring_requests
`;

export class PostgresTutoringRepository implements TutoringRepository {
  readonly #pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  async createConversation(
    scope: OwnedScope,
    courseId: string,
  ): Promise<TutoringConversation | null> {
    if (!scope.courseIds.includes(courseId)) return null;

    const result = await this.#pool.query<ConversationRow>(
      `INSERT INTO tutoring_conversations (owner_id, course_id, expires_at)
       VALUES ($1, $2, now() + INTERVAL '7 days')
       RETURNING id, owner_id, course_id, created_at, updated_at, expires_at, purged_at`,
      [scope.ownerId, courseId],
    );
    const row = result.rows[0];
    return row ? toConversation(row) : null;
  }

  async findConversation(
    scope: OwnedScope,
    conversationId: string,
  ): Promise<TutoringConversation | null> {
    const result = await this.#pool.query<ConversationRow>(
      `SELECT id, owner_id, course_id, created_at, updated_at, expires_at, purged_at
       FROM tutoring_conversations
       WHERE id = $3 AND ${IN_SCOPE}`,
      [scope.ownerId, scope.courseIds, conversationId],
    );
    const row = result.rows[0];
    return row ? toConversation(row) : null;
  }

  async claimRequest(scope: OwnedScope, input: ClaimRequestInput): Promise<ClaimResult | null> {
    if (!scope.courseIds.includes(input.courseId)) return null;

    let conversationId = input.conversationId;
    if (conversationId) {
      const conv = await this.findConversation(scope, conversationId);
      if (!conv || conv.courseId !== input.courseId) return null;
    } else {
      // Find latest conversation in this course or create one atomically.
      const convResult = await this.#pool.query<{ id: string }>(
        `SELECT id FROM tutoring_conversations
         WHERE owner_id = $1 AND course_id = $2
         ORDER BY updated_at DESC LIMIT 1`,
        [scope.ownerId, input.courseId],
      );
      if (convResult.rows.length > 0 && convResult.rows[0]) {
        conversationId = convResult.rows[0].id;
      } else {
        const newConv = await this.createConversation(scope, input.courseId);
        if (!newConv) return null;
        conversationId = newConv.id;
      }
    }

    // Atomic claim with ON CONFLICT (owner_id, request_id) DO NOTHING.
    // Commits immediately so no transaction remains open.
    const insertResult = await this.#pool.query<RequestRow>(
      `INSERT INTO tutoring_requests (
         conversation_id, owner_id, course_id, request_id, question, state, expires_at
       ) VALUES ($1, $2, $3, $4, $5, 'pending', now() + INTERVAL '7 days')
       ON CONFLICT (owner_id, request_id) DO NOTHING
       RETURNING id, conversation_id, owner_id, course_id, request_id, question, state,
                 answer_text, answer_lang, error_reason, created_at, updated_at, completed_at,
                 expires_at, purged_at`,
      [conversationId, scope.ownerId, input.courseId, input.requestId, input.question],
    );

    if (insertResult.rows.length > 0 && insertResult.rows[0]) {
      // Update conversation touch time.
      await this.#pool.query(`UPDATE tutoring_conversations SET updated_at = now() WHERE id = $1`, [
        conversationId,
      ]);
      return { kind: 'claimed', request: toRequest(insertResult.rows[0]) };
    }

    // Row already exists for this owner and request ID; fetch the existing request.
    const existing = await this.findRequestByRequestId(scope, input.requestId);
    if (!existing) {
      // The request belongs to another course or is inaccessible under current scope.
      return null;
    }
    return { kind: 'existing', request: existing };
  }

  async findRequestById(scope: OwnedScope, id: string): Promise<TutoringRequest | null> {
    const result = await this.#pool.query<RequestRow>(
      `${REQUEST_SELECT} WHERE id = $3 AND ${IN_SCOPE}`,
      [scope.ownerId, scope.courseIds, id],
    );
    const row = result.rows[0];
    return row ? toRequest(row) : null;
  }

  async findRequestByRequestId(
    scope: OwnedScope,
    requestId: string,
  ): Promise<TutoringRequest | null> {
    const result = await this.#pool.query<RequestRow>(
      `${REQUEST_SELECT} WHERE request_id = $3 AND ${IN_SCOPE}`,
      [scope.ownerId, scope.courseIds, requestId],
    );
    const row = result.rows[0];
    return row ? toRequest(row) : null;
  }

  async listHistory(scope: OwnedScope, courseId?: string): Promise<readonly TutoringRequest[]> {
    if (courseId !== undefined) {
      if (!scope.courseIds.includes(courseId)) return [];
      const result = await this.#pool.query<RequestRow>(
        `${REQUEST_SELECT} WHERE owner_id = $1 AND course_id = $2 AND purged_at IS NULL ORDER BY created_at DESC`,
        [scope.ownerId, courseId],
      );
      return result.rows.map(toRequest);
    }

    const result = await this.#pool.query<RequestRow>(
      `${REQUEST_SELECT} WHERE ${IN_SCOPE} AND purged_at IS NULL ORDER BY created_at DESC`,
      [scope.ownerId, scope.courseIds],
    );
    return result.rows.map(toRequest);
  }

  async clearHistory(scope: OwnedScope): Promise<void> {
    // Deleting conversations cascades to tutoring_requests via ON DELETE CASCADE.
    await this.#pool.query(`DELETE FROM tutoring_conversations WHERE ${IN_SCOPE}`, [
      scope.ownerId,
      scope.courseIds,
    ]);
  }

  async purgeExpired(now: Date): Promise<number> {
    // Redact private content from expired requests that have not yet been purged.
    // Sets question/answer/error to empty/null and stamps purged_at. Idempotent.
    const requestResult = await this.#pool.query<{ id: string }>(
      `UPDATE tutoring_requests
       SET question = '', answer_text = NULL, answer_lang = NULL, error_reason = NULL,
           purged_at = $1, updated_at = $1
       WHERE expires_at <= $1 AND purged_at IS NULL
       RETURNING id`,
      [now],
    );

    // Mark owning conversations purged when all their requests are purged.
    await this.#pool.query(
      `UPDATE tutoring_conversations c
       SET purged_at = $1, updated_at = $1
       WHERE c.expires_at <= $1 AND c.purged_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM tutoring_requests r
           WHERE r.conversation_id = c.id AND r.purged_at IS NULL
         )`,
      [now],
    );

    return requestResult.rowCount ?? 0;
  }

  async listCourseQuestionsForAnalytics(courseId: string): Promise<readonly string[]> {
    const result = await this.#pool.query<{ question: string }>(
      `SELECT question FROM tutoring_requests
       WHERE course_id = $1 AND purged_at IS NULL AND question IS NOT NULL AND trim(question) != ''`,
      [courseId],
    );
    return result.rows.map((row) => row.question);
  }

  async recordOutcome(
    scope: OwnedScope,
    requestId: string,
    outcome: RecordOutcomeInput,
  ): Promise<TutoringRequest | null> {
    const isCompleted = outcome.state === 'completed';
    const result = await this.#pool.query<RequestRow>(
      `UPDATE tutoring_requests
       SET state = $4,
           answer_text = $5,
           answer_lang = $6,
           error_reason = $7,
           completed_at = CASE WHEN $4 = 'completed' THEN now() ELSE completed_at END,
           updated_at = now()
       WHERE id = $3 AND ${IN_SCOPE}
       RETURNING id, conversation_id, owner_id, course_id, request_id, question, state,
                 answer_text, answer_lang, error_reason, created_at, updated_at, completed_at,
                 expires_at, purged_at`,
      [
        scope.ownerId,
        scope.courseIds,
        requestId,
        outcome.state,
        isCompleted ? (outcome.answerText ?? null) : null,
        isCompleted ? (outcome.answerLang ?? null) : null,
        !isCompleted ? (outcome.errorReason ?? null) : null,
      ],
    );
    const row = result.rows[0];
    return row ? toRequest(row) : null;
  }
}
