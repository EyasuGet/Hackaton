// Screen sharing component with persistent accessible stop control (T3-018-B).
// Connects browser capture using the validated signalling path with native permission.
// Restricts capture to one learner and one support viewer, video of chosen screen only.
// Unsupported mobile browsers disclose the limitation and retain text help.
import { useEffect, useId, useRef, useState } from 'react';
import { T, useT } from '../../shared/i18n/i18n.tsx';
import type { MessageKey } from '../../shared/i18n/messages.ts';
import {
  attachTrackEndedHandler,
  createPeerConnection,
  requestScreenMedia,
  stopMediaStream,
} from './media-lifecycle.ts';
import { canCaptureScreen } from './media-support.ts';
import {
  getIceServers,
  getSharingSessionByHelpRequest,
  initiateSharingSession,
  joinSharingSession,
  listSignals,
  revokeSharingSession,
  sendSignal,
  type IceServerConfig,
  type SharingSession,
  type SharingSignal,
} from './sharing-api.ts';

export interface ScreenShareProps {
  readonly token: string;
  readonly helpRequestId: string;
  /** True when rendering for the learner who owns the help request. */
  readonly isOwner?: boolean;
}

type SharePhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'starting' }
  | { readonly kind: 'active'; readonly session: SharingSession }
  | { readonly kind: 'stopped' }
  | { readonly kind: 'error'; readonly messageKey: MessageKey };

export function ScreenShare({ token, helpRequestId, isOwner = true }: ScreenShareProps) {
  const [phase, setPhase] = useState<SharePhase>({ kind: 'idle' });
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSignalIdRef = useRef<string | undefined>(undefined);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const isStoppingRef = useRef(false);

  const t = useT();
  const headingId = useId();

  const isSupported = canCaptureScreen();

  // Helper to cleanly terminate media, WebRTC, and timers without recursive loops.
  function cleanupLocalMedia() {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (streamRef.current) {
      stopMediaStream(streamRef.current);
      streamRef.current = null;
    }
    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch {
        // Ignore close errors
      }
      pcRef.current = null;
    }
    sessionIdRef.current = null;
    lastSignalIdRef.current = undefined;
    setRemoteStream(null);
  }

  // Learner explicit action to start screen sharing.
  async function onStartSharing() {
    if (phase.kind === 'active' || phase.kind === 'starting') return;
    setPhase({ kind: 'starting' });
    isStoppingRef.current = false;

    let mediaStream: MediaStream;
    try {
      // 1. Browser-native screen picker (must only be invoked by user action)
      mediaStream = await requestScreenMedia({ video: true, audio: false });
    } catch {
      cleanupLocalMedia();
      setPhase({ kind: 'error', messageKey: 'sharing.error' });
      return;
    }

    streamRef.current = mediaStream;

    // 2. Attach track ended listener (invoked when user clicks native stop button)
    const detachHandler = attachTrackEndedHandler(mediaStream, () => {
      void onStopSharing();
    });

    try {
      // 3. Initiate or retrieve signalling session
      const initResult = await initiateSharingSession(token, helpRequestId);
      if (initResult.kind !== 'ok') {
        detachHandler();
        cleanupLocalMedia();
        setPhase({ kind: 'error', messageKey: 'sharing.error' });
        return;
      }

      const session = initResult.value;
      sessionIdRef.current = session.id;

      // 4. Activate session
      await joinSharingSession(token, session.id);

      // 5. Fetch ephemeral ICE servers
      const iceResult = await getIceServers(token, session.id);
      const iceServers: readonly IceServerConfig[] =
        iceResult.kind === 'ok' ? iceResult.value : [{ urls: 'stun:stun.l.google.com:19302' }];

      // 6. Create WebRTC PeerConnection and attach display tracks
      const pc = createPeerConnection(iceServers);
      pcRef.current = pc;

      for (const track of mediaStream.getVideoTracks()) {
        pc.addTrack(track, mediaStream);
      }

      // Handle local ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate && sessionIdRef.current) {
          void sendSignal(token, sessionIdRef.current, 'ice-candidate', event.candidate.toJSON());
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          if (!isStoppingRef.current) {
            void onStopSharing();
          }
        }
      };

      // 7. Create SDP offer and send via signalling
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendSignal(token, session.id, 'offer', {
        type: offer.type,
        sdp: offer.sdp,
      });

      // 8. Start polling for signalling answers and ICE candidates from viewer
      startSignallingLoop(session.id, pc);

      setPhase({ kind: 'active', session });
    } catch {
      detachHandler();
      cleanupLocalMedia();
      setPhase({ kind: 'error', messageKey: 'sharing.error' });
    }
  }

  // Learner or viewer stop control. Ends media tracks and revokes session.
  async function onStopSharing() {
    if (isStoppingRef.current) return;
    isStoppingRef.current = true;

    const currentSessionId = sessionIdRef.current;
    cleanupLocalMedia();

    if (currentSessionId) {
      await revokeSharingSession(token, currentSessionId);
    }

    setPhase({ kind: 'stopped' });
    isStoppingRef.current = false;
  }

  // Signalling poll loop for answer and ICE candidates.
  function startSignallingLoop(sessionId: string, pc: RTCPeerConnection) {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
    }

    pollTimerRef.current = setInterval(() => {
      void (async () => {
        const result = await listSignals(token, sessionId, lastSignalIdRef.current);
        if (result.kind === 'invalid_state') {
          // Session was revoked or expired on the server
          await onStopSharing();
          return;
        }
        if (result.kind !== 'ok') return;

        for (const sig of result.value) {
          lastSignalIdRef.current = sig.id;
          await processSignal(sig, pc);
        }
      })();
    }, 1000);
  }

  async function processSignal(sig: SharingSignal, pc: RTCPeerConnection) {
    try {
      if (sig.type === 'answer' && pc.signalingState === 'have-local-offer') {
        const payload = sig.payload as RTCSessionDescriptionInit;
        await pc.setRemoteDescription(new RTCSessionDescription(payload));
      } else if (sig.type === 'ice-candidate') {
        const payload = sig.payload as RTCIceCandidateInit;
        await pc.addIceCandidate(new RTCIceCandidate(payload));
      }
    } catch {
      // Ignore transient WebRTC state race conditions
    }
  }

  // Support viewer effect: if not owner, check for active session and connect viewer.
  useEffect(() => {
    if (isOwner) return;

    let cancelled = false;
    void (async () => {
      const result = await getSharingSessionByHelpRequest(token, helpRequestId);
      if (cancelled || result.kind !== 'ok') return;

      const session = result.value;
      if (session.state !== 'active' && session.state !== 'pending') return;

      sessionIdRef.current = session.id;
      setPhase({ kind: 'active', session });

      const iceResult = await getIceServers(token, session.id);
      const iceServers: readonly IceServerConfig[] =
        iceResult.kind === 'ok' ? iceResult.value : [{ urls: 'stun:stun.l.google.com:19302' }];

      const pc = createPeerConnection(iceServers);
      pcRef.current = pc;

      pc.ontrack = (event) => {
        const stream = event.streams[0] ?? new MediaStream([event.track]);
        setRemoteStream(stream);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate && sessionIdRef.current) {
          void sendSignal(token, sessionIdRef.current, 'ice-candidate', event.candidate.toJSON());
        }
      };

      // Viewer signalling loop (process offer, create answer)
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = setInterval(() => {
        void (async () => {
          const sigsResult = await listSignals(token, session.id, lastSignalIdRef.current);
          if (sigsResult.kind === 'invalid_state') {
            await onStopSharing();
            return;
          }
          if (sigsResult.kind !== 'ok') return;

          for (const sig of sigsResult.value) {
            lastSignalIdRef.current = sig.id;
            if (sig.type === 'offer' && pc.signalingState === 'stable') {
              const offerDesc = sig.payload as RTCSessionDescriptionInit;
              await pc.setRemoteDescription(new RTCSessionDescription(offerDesc));
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              await sendSignal(token, session.id, 'answer', {
                type: answer.type,
                sdp: answer.sdp,
              });
            } else if (sig.type === 'ice-candidate') {
              const cand = sig.payload as RTCIceCandidateInit;
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            }
          }
        })();
      }, 1000);
    })();

    return () => {
      cancelled = true;
      cleanupLocalMedia();
    };
  }, [token, helpRequestId, isOwner]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      cleanupLocalMedia();
    };
  }, []);

  // Sync remote video stream with videoRef when it updates.
  useEffect(() => {
    if (videoRef.current && remoteStream) {
      videoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // Mobile / Unsupported limitation disclosure
  if (!isSupported && isOwner) {
    return (
      <div
        className="screen-share screen-share--unsupported"
        role="region"
        aria-labelledby={headingId}
      >
        <h3 id={headingId}>
          <T k="sharing.heading" />
        </h3>
        <p className="screen-share-unsupported-note" role="note">
          <T k="sharing.unsupportedMobile" />
        </p>
      </div>
    );
  }

  // Support viewer view
  if (!isOwner) {
    return (
      <div className="screen-share screen-share--viewer" role="region" aria-labelledby={headingId}>
        <h3 id={headingId}>
          <T k="sharing.viewerHeading" />
        </h3>
        {remoteStream ? (
          <div className="screen-share-video-container">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="screen-share-video"
              aria-label={t('sharing.viewerLabel')}
            />
            <p role="status" className="screen-share-status">
              <T k="sharing.viewerConnected" />
            </p>
            <button
              type="button"
              className="screen-share-btn screen-share-btn--stop"
              onClick={() => void onStopSharing()}
            >
              <T k="sharing.disconnect" />
            </button>
          </div>
        ) : (
          <p role="status" className="screen-share-waiting">
            <T k="sharing.viewerWaiting" />
          </p>
        )}
      </div>
    );
  }

  // Learner view
  return (
    <div
      className={`screen-share screen-share--${phase.kind}`}
      role="region"
      aria-labelledby={headingId}
    >
      <h3 id={headingId}>
        <T k="sharing.heading" />
      </h3>

      {phase.kind === 'idle' && (
        <button
          type="button"
          className="screen-share-btn screen-share-btn--start"
          onClick={() => void onStartSharing()}
        >
          <T k="sharing.startSharing" />
        </button>
      )}

      {phase.kind === 'starting' && (
        <p role="status" className="screen-share-starting">
          <T k="sharing.starting" />
        </p>
      )}

      {phase.kind === 'active' && (
        <div className="screen-share-controls">
          <p role="status" aria-live="polite" className="screen-share-status">
            <T k="sharing.activeStatus" />
          </p>
          {/* Persistent accessible stop control */}
          <button
            type="button"
            className="screen-share-btn screen-share-btn--stop"
            aria-label={t('sharing.stopSharing')}
            onClick={() => void onStopSharing()}
          >
            <T k="sharing.stopSharing" />
          </button>
        </div>
      )}

      {phase.kind === 'stopped' && (
        <div className="screen-share-stopped">
          <p role="status" className="screen-share-status">
            <T k="sharing.stoppedStatus" />
          </p>
          {/* Reconnection requires fresh learner action */}
          <button
            type="button"
            className="screen-share-btn screen-share-btn--start"
            onClick={() => void onStartSharing()}
          >
            <T k="sharing.startSharing" />
          </button>
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="screen-share-error">
          <p role="alert">
            <T k={phase.messageKey} />
          </p>
          <button
            type="button"
            className="screen-share-btn screen-share-btn--start"
            onClick={() => void onStartSharing()}
          >
            <T k="sharing.startSharing" />
          </button>
        </div>
      )}
    </div>
  );
}
