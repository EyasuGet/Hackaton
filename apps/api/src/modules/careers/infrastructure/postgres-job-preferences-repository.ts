// PostgreSQL implementation of the JobPreferencesRepository (T3-020-A).
// Manages alert preferences, contacts, and consent lifecycle atomically.
import type pg from 'pg';
import type { OwnedScope } from '../../identity/domain/principal.ts';
import type { CreateSubscriptionInput, JobSubscription } from '../domain/job-preferences.ts';
import type {
  JobPreferencesRepository,
  UnsubscribeResult,
} from '../application/ports/job-preferences-repository.ts';

interface StoredSubscriptionRow {
  id: string;
  learner_id: string;
  channel: string;
  destination: string;
  categories: string[];
  locations: string[];
  active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
  unsubscribed_at: Date | string | null;
}

export class PostgresJobPreferencesRepository implements JobPreferencesRepository {
  readonly #pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  async subscribe(
    scope: OwnedScope,
    input: CreateSubscriptionInput,
    now: Date = new Date(),
  ): Promise<JobSubscription> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');

      const trimmedChannel = input.channel.trim().toLowerCase();
      const trimmedDestination = input.destination.trim();
      const categories = (input.categories ?? []).map((c) => c.trim()).filter(Boolean);
      const locations = (input.locations ?? []).map((l) => l.trim()).filter(Boolean);

      // Upsert contact destination under the learner and channel.
      const contactRes = await client.query<{ id: string }>(
        `INSERT INTO job_alert_contacts
           (learner_id, channel, destination, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $4)
         ON CONFLICT (learner_id, channel) DO UPDATE
           SET destination = EXCLUDED.destination,
               updated_at = EXCLUDED.updated_at
         RETURNING id`,
        [scope.ownerId, trimmedChannel, trimmedDestination, now],
      );
      const contactId = contactRes.rows[0]?.id;
      if (!contactId) {
        throw new Error('Failed to record job alert contact');
      }

      // Insert the active subscription row.
      const subRes = await client.query<StoredSubscriptionRow>(
        `INSERT INTO job_subscriptions
           (learner_id, channel, contact_id, categories, locations, active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, true, $6, $6)
         RETURNING id, learner_id, channel, categories, locations, active, created_at, updated_at, unsubscribed_at`,
        [scope.ownerId, trimmedChannel, contactId, categories, locations, now],
      );

      const row = subRes.rows[0];
      if (!row) {
        throw new Error('Failed to insert job subscription');
      }

      await client.query('COMMIT');

      return this.#mapRow({ ...row, destination: trimmedDestination });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async unsubscribe(
    scope: OwnedScope,
    subscriptionId: string,
    now: Date = new Date(),
  ): Promise<UnsubscribeResult | null> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');

      // Update subscription to inactive, scoped strictly to the owning learner.
      const updateRes = await client.query<StoredSubscriptionRow>(
        `UPDATE job_subscriptions
            SET active = false,
                unsubscribed_at = $3,
                updated_at = $3
          WHERE id = $1 AND learner_id = $2 AND active = true
          RETURNING id, learner_id, channel, categories, locations, active, created_at, updated_at, unsubscribed_at`,
        [subscriptionId, scope.ownerId, now],
      );

      const row = updateRes.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return null;
      }

      const channel = row.channel;

      // Cancel any queued pending delivery intents for this learner and channel.
      const cancelRes = await client.query(
        `UPDATE delivery_intents
            SET status = 'cancelled',
                content_ref = NULL
          WHERE recipient_id = $1 AND channel = $2 AND status = 'pending'`,
        [scope.ownerId, channel],
      );
      const cancelledIntentsCount = cancelRes.rowCount ?? 0;

      // Check if the learner has any other active subscriptions for this channel.
      const remainingRes = await client.query<{ count: string }>(
        `SELECT COUNT(*) AS count
           FROM job_subscriptions
          WHERE learner_id = $1 AND channel = $2 AND active = true`,
        [scope.ownerId, channel],
      );
      const remainingCount = Number(remainingRes.rows[0]?.count ?? '0');

      let contactRemoved = false;
      if (remainingCount === 0) {
        // No remaining active subscriptions for this channel; remove the contact.
        await client.query(
          `DELETE FROM job_alert_contacts
            WHERE learner_id = $1 AND channel = $2`,
          [scope.ownerId, channel],
        );
        contactRemoved = true;
      }

      await client.query('COMMIT');

      return {
        subscription: this.#mapRow({ ...row, destination: '' }),
        cancelledIntentsCount,
        contactRemoved,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async listOwned(scope: OwnedScope): Promise<readonly JobSubscription[]> {
    const result = await this.#pool.query<StoredSubscriptionRow>(
      `SELECT s.id,
              s.learner_id,
              s.channel,
              s.categories,
              s.locations,
              s.active,
              s.created_at,
              s.updated_at,
              s.unsubscribed_at,
              COALESCE(c.destination, '') AS destination
         FROM job_subscriptions s
         LEFT JOIN job_alert_contacts c ON c.id = s.contact_id
        WHERE s.learner_id = $1
        ORDER BY s.created_at DESC`,
      [scope.ownerId],
    );

    return result.rows.map((row) => this.#mapRow(row));
  }

  async getOwned(scope: OwnedScope, subscriptionId: string): Promise<JobSubscription | null> {
    const result = await this.#pool.query<StoredSubscriptionRow>(
      `SELECT s.id,
              s.learner_id,
              s.channel,
              s.categories,
              s.locations,
              s.active,
              s.created_at,
              s.updated_at,
              s.unsubscribed_at,
              COALESCE(c.destination, '') AS destination
         FROM job_subscriptions s
         LEFT JOIN job_alert_contacts c ON c.id = s.contact_id
        WHERE s.id = $1 AND s.learner_id = $2`,
      [subscriptionId, scope.ownerId],
    );

    const row = result.rows[0];
    if (!row) return null;
    return this.#mapRow(row);
  }

  async listActiveSubscriptions(): Promise<readonly JobSubscription[]> {
    const result = await this.#pool.query<StoredSubscriptionRow>(
      `SELECT s.id,
              s.learner_id,
              s.channel,
              s.categories,
              s.locations,
              s.active,
              s.created_at,
              s.updated_at,
              s.unsubscribed_at,
              COALESCE(c.destination, '') AS destination
         FROM job_subscriptions s
         JOIN job_alert_contacts c ON c.id = s.contact_id
        WHERE s.active = true
        ORDER BY s.created_at ASC`,
    );

    return result.rows.map((row) => this.#mapRow(row));
  }

  async cancelPendingIntentsForJob(jobId: string): Promise<number> {
    const result = await this.#pool.query(
      `UPDATE delivery_intents
          SET status = 'cancelled',
              content_ref = NULL
        WHERE content_ref LIKE $1 AND status = 'pending'`,
      [`job:${jobId}:%`],
    );

    return result.rowCount ?? 0;
  }

  #mapRow(row: StoredSubscriptionRow): JobSubscription {
    return {
      id: row.id,
      learnerId: row.learner_id,
      channel: row.channel,
      destination: row.destination,
      categories: row.categories ?? [],
      locations: row.locations ?? [],
      active: row.active,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      unsubscribedAt: row.unsubscribed_at ? new Date(row.unsubscribed_at) : null,
    };
  }
}
