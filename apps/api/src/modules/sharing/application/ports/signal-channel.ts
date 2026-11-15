// Port for exchanging ephemeral WebRTC signalling messages between session participants (T3-018-B).
import type { SharingSignal, SignalType } from '../../domain/sharing-session.ts';

export interface SignalChannel {
  /** Sends a signalling message to the specified session. */
  sendSignal(
    sessionId: string,
    senderId: string,
    type: SignalType,
    payload: unknown,
  ): Promise<SharingSignal>;

  /** Retrieves signalling messages sent by other participants. */
  getSignals(
    sessionId: string,
    recipientId: string,
    afterId?: number,
  ): Promise<readonly SharingSignal[]>;

  /** Clears all signals associated with a session upon revocation or expiry. */
  clearSignals(sessionId: string): Promise<void>;
}
