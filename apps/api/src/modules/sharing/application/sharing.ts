// Sharing use cases: session lifecycle for screen-sharing signalling (T3-018-A / T3-018-B).
// Connects browser capture/media using the validated signalling path with a persistent
// accessible stop control. Only the two authorised participants (learner and support)
// may join, get, exchange signals, or revoke it.
import crypto from 'node:crypto';
import type { RelayConfig } from '../../../bootstrap/config.ts';
import type { Principal } from '../../identity/domain/principal.ts';
import type {
  IceServerConfig,
  SharingSession,
  SharingSignal,
  SignalType,
} from '../domain/sharing-session.ts';
import type { HelpRequestLookup } from './ports/help-request-lookup.ts';
import type { SharingRepository } from './ports/sharing-repository.ts';

/** Returned when the principal lacks permission for the requested operation. */
export type SharingError =
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'invalid_state'; readonly state: string };

export type SharingResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: SharingError };

function ok<T>(value: T): SharingResult<T> {
  return { ok: true, value };
}

function fail<T>(error: SharingError): SharingResult<T> {
  return { ok: false, error };
}

export class Sharing {
  readonly #sessions: SharingRepository;
  readonly #helpLookup: HelpRequestLookup;
  readonly #relayConfig: RelayConfig | undefined;

  constructor(
    sessions: SharingRepository,
    helpLookup: HelpRequestLookup,
    relayConfig?: RelayConfig,
  ) {
    this.#sessions = sessions;
    this.#helpLookup = helpLookup;
    this.#relayConfig = relayConfig;
  }

  /**
   * Initiates a sharing session. Only an authorised participant (the support
   * person who claimed the request, or the learner who owns it) may call this.
   * If an active or pending session already exists for this help request, returns it.
   */
  async initiateSession(
    principal: Principal,
    helpRequestId: string,
  ): Promise<SharingResult<SharingSession>> {
    const participants = await this.#helpLookup.findParticipantsById(helpRequestId);
    if (!participants) return fail({ kind: 'not_found' });
    if (participants.state !== 'claimed' || !participants.claimedBy) {
      return fail({ kind: 'forbidden' });
    }

    const isSupport = principal.role === 'support' && participants.claimedBy === principal.id;
    const isLearner = principal.role === 'learner' && participants.ownerId === principal.id;
    if (!isSupport && !isLearner) return fail({ kind: 'forbidden' });

    // Return existing pending/active session idempotently
    const existing = await this.#sessions.findByHelpRequestId(helpRequestId);
    if (existing && existing.state !== 'revoked' && existing.state !== 'expired') {
      return ok(existing);
    }

    const session = await this.#sessions.createSession(
      helpRequestId,
      participants.ownerId,
      participants.claimedBy,
    );
    return ok(session);
  }

  /**
   * Transitions a pending session to active. The calling principal must be one
   * of the two authorised participants and the session must be in 'pending' state.
   */
  async joinSession(
    principal: Principal,
    sessionId: string,
  ): Promise<SharingResult<SharingSession>> {
    const session = await this.#sessions.findById(sessionId);
    if (!session) return fail({ kind: 'not_found' });
    if (!isParticipant(principal, session)) return fail({ kind: 'not_found' });

    if (session.state === 'revoked' || session.state === 'expired') {
      return fail({ kind: 'invalid_state', state: session.state });
    }
    if (session.state === 'active') {
      // Idempotent: already active is acceptable.
      return ok(session);
    }

    const updated = await this.#sessions.activateSession(sessionId);
    if (!updated) {
      // Another concurrent request won the race or session expired.
      const refreshed = await this.#sessions.findById(sessionId);
      return refreshed ? ok(refreshed) : fail({ kind: 'not_found' });
    }
    return ok(updated);
  }

  /**
   * Revokes a session. Either participant may revoke.
   */
  async revokeSession(
    principal: Principal,
    sessionId: string,
  ): Promise<SharingResult<SharingSession>> {
    const session = await this.#sessions.findById(sessionId);
    if (!session) return fail({ kind: 'not_found' });
    if (!isParticipant(principal, session)) return fail({ kind: 'not_found' });

    if (session.state === 'expired') {
      return fail({ kind: 'invalid_state', state: session.state });
    }
    if (session.state === 'revoked') {
      return ok(session);
    }

    await this.#sessions.revokeSession(sessionId);
    const updated = await this.#sessions.findById(sessionId);
    return updated ? ok(updated) : fail({ kind: 'not_found' });
  }

  /**
   * Returns the session for the calling participant.
   * Returns not_found for a non-participant so session existence cannot be probed.
   */
  async getSession(
    principal: Principal,
    sessionId: string,
  ): Promise<SharingResult<SharingSession>> {
    const session = await this.#sessions.findById(sessionId);
    if (!session) return fail({ kind: 'not_found' });
    if (!isParticipant(principal, session)) return fail({ kind: 'not_found' });
    return ok(session);
  }

  /**
   * Returns the session associated with a help request for an authorised participant.
   */
  async getSessionByHelpRequestId(
    principal: Principal,
    helpRequestId: string,
  ): Promise<SharingResult<SharingSession>> {
    const session = await this.#sessions.findByHelpRequestId(helpRequestId);
    if (!session) return fail({ kind: 'not_found' });
    if (!isParticipant(principal, session)) return fail({ kind: 'not_found' });
    return ok(session);
  }

  /**
   * Sends an ephemeral WebRTC signalling message to the other participant.
   */
  async sendSignal(
    principal: Principal,
    sessionId: string,
    type: SignalType,
    payload: unknown,
  ): Promise<SharingResult<SharingSignal>> {
    const session = await this.#sessions.findById(sessionId);
    if (!session) return fail({ kind: 'not_found' });
    if (!isParticipant(principal, session)) return fail({ kind: 'not_found' });

    if (session.state === 'revoked' || session.state === 'expired') {
      return fail({ kind: 'invalid_state', state: session.state });
    }

    const signal = await this.#sessions.createSignal(sessionId, principal.id, type, payload);
    return ok(signal);
  }

  /**
   * Retrieves signalling messages sent by the other participant.
   */
  async getSignals(
    principal: Principal,
    sessionId: string,
    afterId?: string,
  ): Promise<SharingResult<readonly SharingSignal[]>> {
    const session = await this.#sessions.findById(sessionId);
    if (!session) return fail({ kind: 'not_found' });
    if (!isParticipant(principal, session)) return fail({ kind: 'not_found' });

    if (session.state === 'revoked' || session.state === 'expired') {
      return fail({ kind: 'invalid_state', state: session.state });
    }

    const signals = await this.#sessions.findSignals(sessionId, principal.id, afterId);
    return ok(signals);
  }

  /**
   * Returns WebRTC ICE configuration with short-lived ephemeral credentials
   * when an approved TURN relay is configured.
   */
  async getIceServers(
    principal: Principal,
    sessionId: string,
  ): Promise<SharingResult<readonly IceServerConfig[]>> {
    const session = await this.#sessions.findById(sessionId);
    if (!session) return fail({ kind: 'not_found' });
    if (!isParticipant(principal, session)) return fail({ kind: 'not_found' });

    if (session.state === 'revoked' || session.state === 'expired') {
      return fail({ kind: 'invalid_state', state: session.state });
    }

    if (this.#relayConfig?.enabled && this.#relayConfig.url && this.#relayConfig.secret) {
      const expiry = Math.floor(Date.now() / 1000) + 600;
      const username = `${expiry}:${session.learnerId}`;
      const credential = crypto
        .createHmac('sha1', this.#relayConfig.secret)
        .update(username)
        .digest('base64');
      return ok([
        {
          urls: this.#relayConfig.url,
          username,
          credential,
        },
      ]);
    }
    return ok([{ urls: 'stun:stun.l.google.com:19302' }]);
  }
}

function isParticipant(principal: Principal, session: SharingSession): boolean {
  return principal.id === session.learnerId || principal.id === session.supportId;
}
