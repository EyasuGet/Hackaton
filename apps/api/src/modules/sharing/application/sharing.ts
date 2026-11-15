// Sharing use cases: session lifecycle for screen-sharing signalling (T3-018-A)
// and media negotiation with accessible stop control (T3-018-B).
// A session may only be initiated by the support person who claimed the related help
// request; only the two authorised participants (learner and support) may join, get,
// send signals, or revoke it.
import type { Principal } from '../../identity/domain/principal.ts';
import type { SharingSession, SharingSignal, SignalType } from '../domain/sharing-session.ts';
import type { HelpRequestLookup } from './ports/help-request-lookup.ts';
import type { SharingRepository } from './ports/sharing-repository.ts';
import type { SignalChannel } from './ports/signal-channel.ts';
import { MemorySignalChannel } from '../infrastructure/memory-signal-channel.ts';

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
  readonly #signalChannel: SignalChannel;

  constructor(
    sessions: SharingRepository,
    helpLookup: HelpRequestLookup,
    signalChannel: SignalChannel = new MemorySignalChannel(),
  ) {
    this.#sessions = sessions;
    this.#helpLookup = helpLookup;
    this.#signalChannel = signalChannel;
  }

  /**
   * Initiates a sharing session. Only the support person who claimed the
   * associated help request may call this. Returns the new session.
   */
  async initiateSession(
    principal: Principal,
    helpRequestId: string,
  ): Promise<SharingResult<SharingSession>> {
    if (principal.role !== 'support') return fail({ kind: 'forbidden' });

    const participants = await this.#helpLookup.findParticipantsById(helpRequestId);
    if (!participants) return fail({ kind: 'not_found' });
    if (participants.claimedBy !== principal.id) return fail({ kind: 'forbidden' });
    if (participants.state !== 'claimed') return fail({ kind: 'forbidden' });

    const session = await this.#sessions.createSession(
      helpRequestId,
      participants.ownerId,
      principal.id,
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
   * Cancels active signalling and purges ephemeral signals.
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
      await this.#signalChannel.clearSignals(sessionId);
      return ok(session);
    }

    await this.#sessions.revokeSession(sessionId);
    await this.#signalChannel.clearSignals(sessionId);
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
   * Returns the most recent session for a help request for an authorised participant.
   * Returns not_found for non-participants to prevent probing.
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
   * Posts an ephemeral signalling message (offer, answer, candidate) to an active session.
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

    const signal = await this.#signalChannel.sendSignal(sessionId, principal.id, type, payload);
    return ok(signal);
  }

  /**
   * Retrieves signals sent by the other peer for an active or pending session.
   */
  async getSignals(
    principal: Principal,
    sessionId: string,
    afterId?: number,
  ): Promise<SharingResult<readonly SharingSignal[]>> {
    const session = await this.#sessions.findById(sessionId);
    if (!session) return fail({ kind: 'not_found' });
    if (!isParticipant(principal, session)) return fail({ kind: 'not_found' });

    if (session.state === 'revoked' || session.state === 'expired') {
      return fail({ kind: 'invalid_state', state: session.state });
    }

    const signals = await this.#signalChannel.getSignals(sessionId, principal.id, afterId);
    return ok(signals);
  }
}

function isParticipant(principal: Principal, session: SharingSession): boolean {
  return principal.id === session.learnerId || principal.id === session.supportId;
}
