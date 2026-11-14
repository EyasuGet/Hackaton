// Thin adapter that fulfils the sharing module's HelpRequestLookup port using
// the existing help_requests table. Only the participant fields are read.
import type pg from 'pg';
import type {
  HelpRequestLookup,
  HelpRequestParticipants,
} from '../../application/ports/help-request-lookup.ts';

interface HelpRequestRow {
  owner_id: string;
  claimed_by: string | null;
  state: string;
}

export class PostgresHelpRequestLookup implements HelpRequestLookup {
  readonly #pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  async findParticipantsById(id: string): Promise<HelpRequestParticipants | null> {
    const result = await this.#pool.query<HelpRequestRow>(
      `SELECT owner_id, claimed_by, state FROM help_requests WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      ownerId: row.owner_id,
      claimedBy: row.claimed_by ?? null,
      state: row.state,
    };
  }
}
