// Demo sign-in status: exchanges a one-time handoff code for a synthetic demo
// session and offers sign-out. Labelled throughout as not real authentication.
// Warns before the session expires and offers to extend it (WCAG 2.2.1).
import { useEffect, useRef, useState } from 'react';
import { clearAllDrafts } from '../../shared/drafts/drafts.tsx';
import { exchangeHandoff, extendSession, signOut, type DemoIdentity } from './session-api.ts';

type State =
  | { readonly kind: 'none' | 'signing-in' | 'signed-out' | 'expired' }
  | {
      readonly kind: 'signed-in';
      readonly token: string;
      readonly expiresAt: Date;
      readonly identity: DemoIdentity;
    }
  | { readonly kind: 'error'; readonly message: string };

/** Far more than the 20 seconds WCAG 2.2.1 requires, so a screen-reader user can act. */
export const EXPIRY_WARNING_MS = 5 * 60 * 1000;

const EXCHANGE_ERRORS = {
  invalid: 'This sign-in link is invalid, has expired or was already used. Ask for a new one.',
  origin: 'This page is not allowed to start a demo session.',
  failed: 'Sign-in could not be completed. Check your connection, then ask for a new link.',
} as const;

export function DemoSession({
  handoffCode,
  onSession = () => {},
}: {
  handoffCode: string | null;
  /** Receives the in-memory session token on sign-in and null on sign-out. */
  onSession?: (token: string | null) => void;
}) {
  const [state, setState] = useState<State>({ kind: handoffCode ? 'signing-in' : 'none' });
  const [signOutFailed, setSignOutFailed] = useState(false);
  const [expiringSoon, setExpiringSoon] = useState(false);
  const [extendFailed, setExtendFailed] = useState(false);
  // A code works once, so the exchange must not repeat when StrictMode re-runs effects.
  const started = useRef(false);
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!handoffCode || started.current) return;
    started.current = true;
    void exchangeHandoff(handoffCode).then((result) => {
      if (result.kind === 'session') {
        setState({
          kind: 'signed-in',
          token: result.token,
          expiresAt: result.expiresAt,
          identity: result.identity,
        });
        onSession(result.token);
      } else {
        setState({ kind: 'error', message: EXCHANGE_ERRORS[result.kind] });
      }
    });
  }, [handoffCode, onSession]);

  const expiresAt = state.kind === 'signed-in' ? state.expiresAt.getTime() : null;
  useEffect(() => {
    if (expiresAt === null) return;
    const untilExpiry = expiresAt - Date.now();
    const warn = setTimeout(() => setExpiringSoon(true), untilExpiry - EXPIRY_WARNING_MS);
    const expire = setTimeout(() => {
      setExpiringSoon(false);
      setState({ kind: 'expired' });
      onSession(null);
    }, untilExpiry);
    return () => {
      clearTimeout(warn);
      clearTimeout(expire);
    };
  }, [expiresAt, onSession]);

  async function onExtend(current: Extract<State, { kind: 'signed-in' }>) {
    const extended = await extendSession(current.token);
    if (!extended) {
      setExtendFailed(true);
      return;
    }
    setExtendFailed(false);
    setExpiringSoon(false);
    setState({ ...current, expiresAt: extended });
  }

  async function onSignOut(token: string) {
    if (!(await signOut(token))) {
      setSignOutFailed(true);
      return;
    }
    setSignOutFailed(false);
    // An explicit sign-out may be on a shared device, so unsent text goes too.
    clearAllDrafts();
    setState({ kind: 'signed-out' });
    onSession(null);
    // The Sign out button disappears, so move focus to the message that replaces it.
    statusRef.current?.focus();
  }

  return (
    // Operator-facing demo text is English only, so it is tagged English for correct
    // screen-reader pronunciation in other interface languages (WCAG 3.1.2, T3-050).
    <section className="demo-session" aria-labelledby="demo-session-heading" lang="en">
      <h2 id="demo-session-heading">Demo sign-in</h2>
      <p ref={statusRef} tabIndex={-1} role="status" aria-label="Sign-in status">
        {state.kind === 'none' &&
          'Not signed in. Open the single-use sign-in link from the demo operator.'}
        {state.kind === 'signing-in' && 'Signing in…'}
        {state.kind === 'signed-out' && 'You have signed out. The session has ended.'}
        {state.kind === 'expired' &&
          'Your session has ended. Anything you typed is saved on this device. Open a new sign-in link to continue.'}
        {state.kind === 'signed-in' &&
          `Signed in as ${state.identity.label} (${state.identity.role}). Synthetic demo identity — not real authentication.`}
      </p>
      {state.kind === 'error' && <p role="alert">{state.message}</p>}
      {state.kind === 'signed-in' && expiringSoon && (
        <div role="alert">
          <p>
            Your session ends in less than 5 minutes. Anything you typed is saved on this device.
          </p>
          <button type="button" onClick={() => void onExtend(state)}>
            Stay signed in
          </button>
        </div>
      )}
      {extendFailed && (
        <p role="alert">The session could not be extended. Your typed text is still saved.</p>
      )}
      {signOutFailed && (
        <p role="alert">Sign-out could not be confirmed. Check your connection and try again.</p>
      )}
      {state.kind === 'signed-in' && (
        <button type="button" onClick={() => void onSignOut(state.token)}>
          Sign out
        </button>
      )}
    </section>
  );
}
