// Demo sign-in status: exchanges a one-time handoff code for a synthetic demo
// session and offers sign-out. Labelled throughout as not real authentication.
import { useEffect, useRef, useState } from 'react';
import { exchangeHandoff, signOut, type DemoIdentity } from './session-api.ts';

type State =
  | { readonly kind: 'none' | 'signing-in' | 'signed-out' }
  | { readonly kind: 'signed-in'; readonly token: string; readonly identity: DemoIdentity }
  | { readonly kind: 'error'; readonly message: string };

const EXCHANGE_ERRORS = {
  invalid: 'This sign-in link is invalid, has expired or was already used. Ask for a new one.',
  origin: 'This page is not allowed to start a demo session.',
  failed: 'Sign-in could not be completed. Check your connection, then ask for a new link.',
} as const;

export function DemoSession({ handoffCode }: { handoffCode: string | null }) {
  const [state, setState] = useState<State>({ kind: handoffCode ? 'signing-in' : 'none' });
  const [signOutFailed, setSignOutFailed] = useState(false);
  // A code works once, so the exchange must not repeat when StrictMode re-runs effects.
  const started = useRef(false);
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!handoffCode || started.current) return;
    started.current = true;
    void exchangeHandoff(handoffCode).then((result) =>
      setState(
        result.kind === 'session'
          ? { kind: 'signed-in', token: result.token, identity: result.identity }
          : { kind: 'error', message: EXCHANGE_ERRORS[result.kind] },
      ),
    );
  }, [handoffCode]);

  async function onSignOut(token: string) {
    if (!(await signOut(token))) {
      setSignOutFailed(true);
      return;
    }
    setSignOutFailed(false);
    setState({ kind: 'signed-out' });
    // The Sign out button disappears, so move focus to the message that replaces it.
    statusRef.current?.focus();
  }

  return (
    <section className="demo-session" aria-labelledby="demo-session-heading">
      <h2 id="demo-session-heading">Demo sign-in</h2>
      <p ref={statusRef} tabIndex={-1} role="status" aria-label="Sign-in status">
        {state.kind === 'none' &&
          'Not signed in. Open the single-use sign-in link from the demo operator.'}
        {state.kind === 'signing-in' && 'Signing in…'}
        {state.kind === 'signed-out' && 'You have signed out. The session has ended.'}
        {state.kind === 'signed-in' &&
          `Signed in as ${state.identity.label} (${state.identity.role}). Synthetic demo identity — not real authentication.`}
      </p>
      {state.kind === 'error' && <p role="alert">{state.message}</p>}
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
