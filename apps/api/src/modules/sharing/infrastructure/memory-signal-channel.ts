// In-memory implementation of ephemeral WebRTC signalling channel (T3-018-B).
// Signalling messages (SDP offer/answer, ICE candidates) live only during negotiation.
// Signals are bounded in memory and purged upon session revocation or disconnect.
import type { SignalChannel } from '../application/ports/signal-channel.ts';
import type { SharingSignal, SignalType } from '../domain/sharing-session.ts';

const MAX_SIGNALS_PER_SESSION = 100;

export class MemorySignalChannel implements SignalChannel {
  readonly #signals = new Map<string, SharingSignal[]>();
  #nextId = 1;

  sendSignal(
    sessionId: string,
    senderId: string,
    type: SignalType,
    payload: unknown,
  ): Promise<SharingSignal> {
    const signal: SharingSignal = {
      id: this.#nextId++,
      sessionId,
      senderId,
      type,
      payload,
      createdAt: new Date().toISOString(),
    };

    let sessionSignals = this.#signals.get(sessionId);
    if (!sessionSignals) {
      sessionSignals = [];
      this.#signals.set(sessionId, sessionSignals);
    }

    sessionSignals.push(signal);
    if (sessionSignals.length > MAX_SIGNALS_PER_SESSION) {
      sessionSignals.shift();
    }

    return Promise.resolve(signal);
  }

  getSignals(
    sessionId: string,
    recipientId: string,
    afterId?: number,
  ): Promise<readonly SharingSignal[]> {
    const sessionSignals = this.#signals.get(sessionId);
    if (!sessionSignals) return Promise.resolve([]);

    const filtered = sessionSignals.filter((s) => {
      // Only deliver messages sent by the *other* participant
      if (s.senderId === recipientId) return false;
      if (afterId !== undefined && s.id <= afterId) return false;
      return true;
    });

    return Promise.resolve(filtered);
  }

  clearSignals(sessionId: string): Promise<void> {
    this.#signals.delete(sessionId);
    return Promise.resolve();
  }
}
