// Storage port for sharing sessions. Implementations must enforce session
// ownership and state constraints so the use-case layer can trust the results.
import type { SharingSession, SharingSignal, SignalType } from '../../domain/sharing-session.ts';

export interface SharingRepository {
  /**
   * Creates a new sharing session in 'pending' state for the given help request.
   * Callers must verify the help-request relationship before calling this.
   */
  createSession(
    helpRequestId: string,
    learnerId: string,
    supportId: string,
  ): Promise<SharingSession>;

  /** Returns the session by id, or null when it does not exist. */
  findById(id: string): Promise<SharingSession | null>;

  /** Returns the most-recent session for a help request, or null. */
  findByHelpRequestId(helpRequestId: string): Promise<SharingSession | null>;

  /**
   * Transitions state to 'revoked' and records revokedAt.
   * No-ops when the session is already revoked or expired.
   */
  revokeSession(id: string): Promise<void>;

  /**
   * Transitions state to 'expired'.
   * No-ops when the session is already revoked or expired.
   */
  expireSession(id: string): Promise<void>;

  /**
   * Transitions state from 'pending' to 'active'.
   * Returns the updated session, or null when the transition does not apply
   * (session not found, wrong state, or already active).
   */
  activateSession(id: string): Promise<SharingSession | null>;

  /**
   * Appends an ephemeral WebRTC signalling message to the session.
   */
  createSignal(
    sessionId: string,
    senderId: string,
    type: SignalType,
    payload: unknown,
  ): Promise<SharingSignal>;

  /**
   * Lists signals for a session sent by the other participant, optionally after a cursor id.
   */
  findSignals(
    sessionId: string,
    excludeSenderId: string,
    afterId?: string,
  ): Promise<readonly SharingSignal[]>;
}
