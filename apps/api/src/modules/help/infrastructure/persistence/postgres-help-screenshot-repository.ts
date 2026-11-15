// PostgreSQL storage for help-request screenshots. The access rule and the
// request's expiry are part of every statement.
import type pg from 'pg';
import type { ScreenshotImage } from '../../application/help-screenshots.ts';
import type { HelpScreenshotRepository } from '../../application/ports/help-screenshot-repository.ts';

interface ScreenshotRow {
  mime_type: ScreenshotImage['mimeType'];
  data: Buffer;
}

function toImage(row: ScreenshotRow | undefined): ScreenshotImage | null {
  return row ? { mimeType: row.mime_type, data: row.data } : null;
}

export class PostgresHelpScreenshotRepository implements HelpScreenshotRepository {
  readonly #pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  async attach(ownerId: string, helpRequestId: string, image: ScreenshotImage): Promise<boolean> {
    const result = await this.#pool.query(
      `INSERT INTO help_request_screenshots (help_request_id, mime_type, data)
       SELECT id, $3, $4 FROM help_requests
        WHERE id = $1 AND owner_id = $2 AND state IN ('waiting', 'claimed') AND expires_at > now()
       ON CONFLICT (help_request_id)
         DO UPDATE SET mime_type = EXCLUDED.mime_type, data = EXCLUDED.data, created_at = now()`,
      [helpRequestId, ownerId, image.mimeType, image.data],
    );
    return result.rowCount === 1;
  }

  async remove(ownerId: string, helpRequestId: string): Promise<boolean> {
    const result = await this.#pool.query(
      `DELETE FROM help_request_screenshots s USING help_requests r
        WHERE s.help_request_id = r.id AND r.id = $1 AND r.owner_id = $2`,
      [helpRequestId, ownerId],
    );
    return result.rowCount === 1;
  }

  async findForOwner(ownerId: string, helpRequestId: string): Promise<ScreenshotImage | null> {
    const result = await this.#pool.query<ScreenshotRow>(
      `SELECT s.mime_type, s.data FROM help_request_screenshots s
         JOIN help_requests r ON r.id = s.help_request_id
        WHERE r.id = $1 AND r.owner_id = $2 AND r.expires_at > now()`,
      [helpRequestId, ownerId],
    );
    return toImage(result.rows[0]);
  }

  async findForClaimant(staffId: string, helpRequestId: string): Promise<ScreenshotImage | null> {
    const result = await this.#pool.query<ScreenshotRow>(
      `SELECT s.mime_type, s.data FROM help_request_screenshots s
         JOIN help_requests r ON r.id = s.help_request_id
        WHERE r.id = $1 AND r.claimed_by = $2 AND r.state = 'claimed' AND r.expires_at > now()`,
      [helpRequestId, staffId],
    );
    return toImage(result.rows[0]);
  }
}
