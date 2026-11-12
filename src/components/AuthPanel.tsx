import { useState } from 'react';
import type { AuthState } from '../hooks/useAuth';

export function AuthPanel({ auth }: { auth: AuthState }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'register'>('signin');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  if (!auth.configured) {
    return (
      <section className="panel auth-panel" aria-label="Sign in">
        <h2>Firebase is not configured</h2>
        <p>
          This build has no Firebase web configuration in its environment, so sign-in and ticket
          data are switched off. Copy <code>.env.example</code> to <code>.env</code>, fill in the
          web app values from the Firebase console, and restart the dev server.
        </p>
      </section>
    );
  }

  return (
    <section className="panel auth-panel" aria-label="Sign in">
      <h2>Sign in to your inbox</h2>
      <p className="auth-note">
        Your tickets, drafts, and route events are stored under your own account and nobody
        else&rsquo;s.
      </p>
      <button
        type="button"
        className="button button--primary"
        disabled={busy}
        onClick={() => void run(auth.signInGoogle)}
      >
        Continue with Google
      </button>
      <div className="auth-divider" aria-hidden="true">
        <span>or use email</span>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(() =>
            mode === 'signin'
              ? auth.signInEmail(email, password)
              : auth.registerEmail(email, password),
          );
        }}
      >
        <label>
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            required
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button button--secondary" disabled={busy}>
          {mode === 'signin' ? 'Sign in with email' : 'Create account'}
        </button>
      </form>
      <button
        type="button"
        className="link-button"
        onClick={() => setMode(mode === 'signin' ? 'register' : 'signin')}
      >
        {mode === 'signin' ? 'New here? Create an account' : 'Already registered? Sign in'}
      </button>
    </section>
  );
}
