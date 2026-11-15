// PostgreSQL implementation of PhoneVerificationRepository (T3-003-E, T3-021-A).
// Manages storage for verification tokens, challenge digests, attempt limits,
// and verified learner-to-phone bindings.
// Plaintext OTP is NEVER stored in repository storage.

import type pg from 'pg';
import {
  PhoneVerificationCode,
  type PhoneVerificationStatus,
} from '../domain/phone-verification.ts';
import type { PhoneVerificationRepository } from '../application/ports/phone-verification-repository.ts';
import type { Principal, Role } from '../../identity/domain/principal.ts';

interface StoredPhoneVerificationRow {
  id: string;
  learner_id: string;
  phone_number: string;
  code_digest: string;
  salt: string;
  attempts: number;
  max_attempts: number;
  created_at: Date | string;
  expires_at: Date | string;
  verified_at: Date | string | null;
  status: string;
}

export class PostgresPhoneVerificationRepository implements PhoneVerificationRepository {
  readonly #pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  async findLatestByPhoneNumber(phoneNumber: string): Promise<PhoneVerificationCode | null> {
    const result = await this.#pool.query<StoredPhoneVerificationRow>(
      `SELECT id, learner_id, phone_number, code_digest, salt, attempts, max_attempts, created_at, expires_at, verified_at, status
         FROM phone_verification_codes
        WHERE phone_number = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [phoneNumber],
    );

    const row = result.rows[0];
    if (!row) return null;
    return this.#mapRow(row);
  }

  async findActiveByLearnerAndPhone(
    learnerId: string,
    phoneNumber: string,
  ): Promise<PhoneVerificationCode | null> {
    const result = await this.#pool.query<StoredPhoneVerificationRow>(
      `SELECT id, learner_id, phone_number, code_digest, salt, attempts, max_attempts, created_at, expires_at, verified_at, status
         FROM phone_verification_codes
        WHERE learner_id = $1
          AND phone_number = $2
          AND status = 'pending'
          AND attempts < max_attempts
          AND verified_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1`,
      [learnerId, phoneNumber],
    );

    const row = result.rows[0];
    if (!row) return null;
    return this.#mapRow(row);
  }

  async save(record: PhoneVerificationCode): Promise<void> {
    await this.#pool.query(
      `INSERT INTO phone_verification_codes (
         id, learner_id, phone_number, code_digest, salt, attempts, max_attempts, created_at, expires_at, verified_at, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET
         attempts = EXCLUDED.attempts,
         verified_at = EXCLUDED.verified_at,
         status = EXCLUDED.status`,
      [
        record.id,
        record.learnerId,
        record.phoneNumber,
        record.codeDigest,
        record.salt,
        record.attempts,
        record.maxAttempts,
        record.createdAt,
        record.expiresAt,
        record.verifiedAt,
        record.getStatus(),
      ],
    );
  }

  async isPhoneVerifiedForLearner(learnerId: string, phoneNumber: string): Promise<boolean> {
    const result = await this.#pool.query(
      `SELECT 1
         FROM learner_verified_phones
        WHERE learner_id = $1 AND phone_number = $2
        LIMIT 1`,
      [learnerId, phoneNumber],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async markPhoneVerified(learnerId: string, phoneNumber: string, verifiedAt: Date): Promise<void> {
    await this.#pool.query(
      `INSERT INTO learner_verified_phones (learner_id, phone_number, verified_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (learner_id, phone_number) DO UPDATE SET
         verified_at = EXCLUDED.verified_at`,
      [learnerId, phoneNumber, verifiedAt],
    );
  }

  async revokePhoneVerification(learnerId: string, phoneNumber?: string): Promise<void> {
    if (phoneNumber) {
      await this.#pool.query(
        `DELETE FROM learner_verified_phones
          WHERE learner_id = $1 AND phone_number = $2`,
        [learnerId, phoneNumber],
      );
    } else {
      await this.#pool.query(
        `DELETE FROM learner_verified_phones
          WHERE learner_id = $1`,
        [learnerId],
      );
    }
  }

  async purgeExpired(now: Date): Promise<number> {
    const result = await this.#pool.query(
      `DELETE FROM phone_verification_codes
        WHERE expires_at <= $1 OR status IN ('exhausted', 'expired')`,
      [now],
    );
    return result.rowCount ?? 0;
  }

  async findLearnerByPhoneNumber(phoneNumber: string): Promise<string | null> {
    const result = await this.#pool.query<{ learner_id: string }>(
      `SELECT learner_id
         FROM learner_verified_phones
        WHERE phone_number = $1
        ORDER BY verified_at DESC
        LIMIT 1`,
      [phoneNumber],
    );
    return result.rows[0]?.learner_id ?? null;
  }

  async findPrincipalByPhoneNumber(phoneNumber: string): Promise<Principal | null> {
    const result = await this.#pool.query<{
      id: string;
      role: string;
      label: string;
      demo: boolean;
      course_ids: string[];
    }>(
      `SELECT p.id, p.role, p.label, p.is_demo AS demo,
              coalesce(array_agg(g.course_id ORDER BY g.course_id)
                       FILTER (WHERE g.course_id IS NOT NULL), '{}') AS course_ids
         FROM learner_verified_phones vp
         JOIN principals p ON p.id = vp.learner_id
         LEFT JOIN course_grants g ON g.principal_id = p.id
        WHERE vp.phone_number = $1
        GROUP BY p.id`,
      [phoneNumber],
    );

    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      role: row.role as Role,
      label: row.label,
      demo: row.demo,
      courseIds: row.course_ids,
    };
  }

  #mapRow(row: StoredPhoneVerificationRow): PhoneVerificationCode {
    return new PhoneVerificationCode({
      id: row.id,
      learnerId: row.learner_id,
      phoneNumber: row.phone_number,
      codeDigest: row.code_digest,
      salt: row.salt,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      createdAt: new Date(row.created_at),
      expiresAt: new Date(row.expires_at),
      verifiedAt: row.verified_at ? new Date(row.verified_at) : null,
      currentStatus: row.status as PhoneVerificationStatus,
    });
  }
}
