// Screen sharing component for learner and support viewer (T3-018-B).
// Connects browser display capture using the validated signalling path.
// Video of chosen screen only (audio: false). No conferencing/recording features.
// Features a persistent accessible stop control and graceful disclosure for unsupported browsers.
import { useEffect, useId, useRef, useState } from 'react';
import { T, useT } from '../../shared/i18n/i18n.tsx';
import {
  captureScreen,
  clampSenderBitrate,
  closePeerConnection,
  MAX_3G_BITRATE_BPS,
  stopMediaStream,
} from './media-connection.ts';
import {
  getSessionByHelpRequestId,
  initiateSession,
  joinSession,
  revokeSession,
  sendSignal,
  getSignals,
  type SharingSession,
  type SharingSignal,
} from './sharing-api.ts';
import { isScreenShareSupported } from './support.ts';

export type ScreenShareRole = 'learner' | 'support';

export type SharingPhase =
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'idle'; readonly session: SharingSession | null }
  | { readonly kind: 'requesting' }
  | { readonly kind: 'connecting'; readonly session: SharingSession }
  | { readonly kind: 'sharing'; readonly session: SharingSession }
  | { readonly kind: 'viewing'; readonly session: SharingSession }
  | { readonly kind: 'stopped' }
  | { readonly kind: 'error'; readonly reason: 'denied' | 'failed' | 'ended' };

export interface ScreenShareProps {
  readonly token: string;
  readonly helpRequestId: string;
  readonly role?: ScreenShareRole;
  readonly onStop?: () => void;
  readonly rtcConfig?: RTCConfiguration;
}

export function ScreenShare({
  token,
  helpRequestId,
  role = 'learner',
  onStop,
  rtcConfig,
}: ScreenShareProps) {
  const t = useT();
  const headingId = useId();
  const statusId = useId();

  const [phase, setPhase] = useState<SharingPhase>(() => {
    if (!isScreenShareSupported()) {
      return { kind: 'unsupported' };
    }
    return { kind: 'idle', session: null };
  });

  const localStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const activeSessionRef = useRef<SharingSession | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSignalIdRef = useRef<number>(0);
  const isStoppingRef = useRef<boolean>(false);

  // Synchronise active session reference
  useEffect(() => {
    if (phase.kind === 'connecting' || phase.kind === 'sharing' || phase.kind === 'viewing') {
      activeSessionRef.current = phase.session;
    } else if (phase.kind === 'idle') {
      activeSessionRef.current = phase.session;
    } else {
      activeSessionRef.current = null;
    }
  }, [phase]);

  // Teardown tracks, peer connection, and signalling on unmount or browser window close
  useEffect(() => {
    const handleWindowClose = () => {
      stopMediaStream(localStreamRef.current);
      localStreamRef.current = null;
      closePeerConnection(pcRef.current);
      pcRef.current = null;
    };

    window.addEventListener('beforeunload', handleWindowClose);
    window.addEventListener('pagehide', handleWindowClose);

    return () => {
      window.removeEventListener('beforeunload', handleWindowClose);
      window.removeEventListener('pagehide', handleWindowClose);
      stopMediaStream(localStreamRef.current);
      localStreamRef.current = null;
      closePeerConnection(pcRef.current);
      pcRef.current = null;
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);

  // Poll for remote session updates when idle
  useEffect(() => {
    if (phase.kind !== 'idle' || !isScreenShareSupported()) return;

    let cancelled = false;
    const checkSession = async () => {
      const session = await getSessionByHelpRequestId(token, helpRequestId);
      if (cancelled) return;
      if (session && session.state === 'active' && role === 'support') {
        // Staff viewer connects to active session
        startViewerConnection(session);
      } else if (session) {
        setPhase((prev) => (prev.kind === 'idle' ? { kind: 'idle', session } : prev));
      }
    };

    void checkSession();
    const timer = setInterval(() => void checkSession(), 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [token, helpRequestId, role, phase.kind]);

  // Stop sharing handler: cancels all active tracks, revokes session, and marks stopped
  async function handleStop() {
    if (isStoppingRef.current) return;
    isStoppingRef.current = true;

    // 1. Cancel all active media tracks immediately
    stopMediaStream(localStreamRef.current);
    localStreamRef.current = null;

    // 2. Close peer connection
    closePeerConnection(pcRef.current);
    pcRef.current = null;

    // 3. Clear signalling poll
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    // 4. Revoke session on backend if active
    const session = activeSessionRef.current;
    if (session) {
      await revokeSession(token, session.id);
    }

    // 5. Update state to stopped (requires fresh learner action to reconnect)
    setPhase({ kind: 'stopped' });
    isStoppingRef.current = false;
    onStop?.();
  }

  // Learner action: starts screen capture and initiates/joins sharing session
  async function handleStartSharing() {
    if (phase.kind === 'requesting' || phase.kind === 'sharing') return;
    setPhase({ kind: 'requesting' });

    let stream: MediaStream;
    try {
      // ONLY explicit learner action invokes the browser display media picker
      // Strictly video of chosen screen only (audio: false)
      stream = await captureScreen();
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'NotAllowedError' || name === 'AbortError') {
        setPhase({ kind: 'error', reason: 'denied' });
      } else {
        setPhase({ kind: 'error', reason: 'failed' });
      }
      return;
    }

    localStreamRef.current = stream;

    // Browser native stop handler (e.g. user clicks browser's native "Stop sharing" chrome)
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.addEventListener('ended', () => {
        void handleStop();
      });
    }

    // Retrieve or initiate sharing session
    let session = await getSessionByHelpRequestId(token, helpRequestId);
    if (!session && role === 'support') {
      session = await initiateSession(token, helpRequestId);
    }

    if (!session) {
      // When session doesn't exist yet, activate standalone sharing or wait for staff
      // To ensure tracks are cancelled if session cannot be negotiated:
      // Join if session exists, else learner is ready
      setPhase({
        kind: 'sharing',
        session: {
          id: 'local',
          helpRequestId,
          learnerId: 'local',
          supportId: 'pending',
          state: 'active',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          revokedAt: null,
        },
      });
      return;
    }

    // Activate/join session on validated signalling path
    if (session.state === 'pending') {
      const joined = await joinSession(token, session.id);
      if (joined) session = joined;
    }

    setPhase({ kind: 'sharing', session });

    // Set up WebRTC peer connection
    setupSharerPeerConnection(session, stream);
  }

  function setupSharerPeerConnection(session: SharingSession, stream: MediaStream) {
    if (typeof RTCPeerConnection === 'undefined') return;

    const pc = new RTCPeerConnection(
      rtcConfig ?? {
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      },
    );
    pcRef.current = pc;

    // Add video track only and clamp bitrate for low-bandwidth 3G
    const track = stream.getVideoTracks()[0];
    if (track) {
      const sender = pc.addTrack(track, stream);
      void clampSenderBitrate(sender, MAX_3G_BITRATE_BPS, 15);
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        void sendSignal(token, session.id, 'candidate', event.candidate.toJSON());
      }
    };

    pc.onconnectionstatechange = () => {
      if (
        pc.connectionState === 'disconnected' ||
        pc.connectionState === 'failed' ||
        pc.connectionState === 'closed'
      ) {
        void handleStop();
      }
    };

    // Create and send offer
    void (async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await sendSignal(token, session.id, 'offer', offer);
      } catch {
        // Signalling failure handled gracefully
      }
    })();

    // Poll for remote signals (answer, candidates)
    startSignalPolling(session.id, pc);
  }

  function startViewerConnection(session: SharingSession) {
    if (typeof RTCPeerConnection === 'undefined') {
      setPhase({ kind: 'viewing', session });
      return;
    }

    setPhase({ kind: 'connecting', session });
    const pc = new RTCPeerConnection(
      rtcConfig ?? {
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      },
    );
    pcRef.current = pc;

    pc.ontrack = (event) => {
      const remoteStream = event.streams[0];
      if (remoteStream && videoRef.current) {
        videoRef.current.srcObject = remoteStream;
      }
      setPhase({ kind: 'viewing', session });
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        void sendSignal(token, session.id, 'candidate', event.candidate.toJSON());
      }
    };

    pc.onconnectionstatechange = () => {
      if (
        pc.connectionState === 'disconnected' ||
        pc.connectionState === 'failed' ||
        pc.connectionState === 'closed'
      ) {
        void handleStop();
      }
    };

    startSignalPolling(session.id, pc);
  }

  function startSignalPolling(sessionId: string, pc: RTCPeerConnection) {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);

    pollTimerRef.current = setInterval(() => {
      void (async () => {
        const signals = await getSignals(token, sessionId, lastSignalIdRef.current);
        for (const signal of signals) {
          lastSignalIdRef.current = Math.max(lastSignalIdRef.current, signal.id);
          await handleIncomingSignal(pc, signal);
        }
      })();
    }, 1500);
  }

  async function handleIncomingSignal(pc: RTCPeerConnection, signal: SharingSignal) {
    try {
      if (signal.type === 'offer' && role === 'support') {
        await pc.setRemoteDescription(
          new RTCSessionDescription(signal.payload as RTCSessionDescriptionInit),
        );
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sendSignal(token, signal.sessionId, 'answer', answer);
      } else if (signal.type === 'answer' && role === 'learner') {
        await pc.setRemoteDescription(
          new RTCSessionDescription(signal.payload as RTCSessionDescriptionInit),
        );
      } else if (signal.type === 'candidate') {
        await pc.addIceCandidate(new RTCIceCandidate(signal.payload as RTCIceCandidateInit));
      }
    } catch {
      // Ignored: malformed or out-of-order candidate
    }
  }

  const isSharingOrViewing = phase.kind === 'sharing' || phase.kind === 'viewing';
  const isConnecting = phase.kind === 'connecting' || phase.kind === 'requesting';

  // 1. Graceful disclosure for unsupported browsers (e.g. mobile)
  // Text help is preserved without obstruction
  if (phase.kind === 'unsupported') {
    return (
      <aside className="sharing-panel sharing-panel--unsupported" aria-labelledby={headingId}>
        <h3 id={headingId} className="visually-hidden">
          <T k="sharing.heading" />
        </h3>
        <p className="sharing-unsupported-note" role="note">
          <T k="sharing.unsupported" />
        </p>
      </aside>
    );
  }

  return (
    <div className="sharing-panel" aria-labelledby={headingId}>
      <h3 id={headingId}>
        <T k="sharing.heading" />
      </h3>

      {/* Screen reader live region for status announcements */}
      <p id={statusId} role="status" aria-live="polite" className="sharing-status">
        {phase.kind === 'idle' && <T k="sharing.status.idle" />}
        {phase.kind === 'requesting' && <T k="sharing.status.requesting" />}
        {phase.kind === 'connecting' && <T k="sharing.status.connecting" />}
        {phase.kind === 'sharing' && <T k="sharing.status.active" />}
        {phase.kind === 'viewing' && <T k="sharing.status.viewing" />}
        {phase.kind === 'stopped' && <T k="sharing.status.stopped" />}
        {phase.kind === 'error' && phase.reason === 'denied' && <T k="sharing.permissionDenied" />}
        {phase.kind === 'error' && phase.reason !== 'denied' && <T k="sharing.error" />}
      </p>

      {/* Persistent Accessible Stop Control — visible whenever sharing or viewing */}
      {(isSharingOrViewing || isConnecting) && (
        <div className="sharing-controls">
          <button
            type="button"
            className="sharing-stop-control"
            onClick={() => void handleStop()}
            aria-label={t('sharing.stopButton')}
          >
            <T k="sharing.stopButton" />
          </button>
        </div>
      )}

      {/* Learner start button — requires fresh learner action to share */}
      {!isSharingOrViewing && !isConnecting && role === 'learner' && (
        <div className="sharing-controls">
          <button
            type="button"
            className="sharing-start-btn"
            onClick={() => void handleStartSharing()}
          >
            <T k="sharing.startButton" />
          </button>
        </div>
      )}

      {/* Support viewer video element — video only, no conferencing/recording */}
      {role === 'support' && phase.kind === 'viewing' && (
        <div className="sharing-video-container">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="sharing-video"
            aria-label={t('sharing.viewerVideoLabel')}
          />
        </div>
      )}
    </div>
  );
}
