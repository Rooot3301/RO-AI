import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { Wordmark } from '../components/ui/Logo';
import { Button, Banner } from '../components/ui/primitives';
import { Field } from '../components/ui/forms';
import { ApiError } from '../api/client';
import { useDocumentTitle } from '../hooks/useNow';
import './Login.css';

export default function LoginPage() {
  useDocumentTitle('Connexion');
  const auth = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from ?? '/';
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (auth.status === 'authed') return <Navigate to={from === '/login' ? '/' : from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    try { await auth.login(user.trim(), pass); nav(from === '/login' ? '/' : from, { replace: true }); }
    catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'Identifiant ou mot de passe incorrect.'
        : err instanceof ApiError && err.status === 429 ? 'Trop de tentatives. Patientez avant de réessayer.'
        : err instanceof Error ? err.message : 'Connexion impossible.');
      setPass('');
    } finally { setBusy(false); }
  };

  return (
    <main className="login">
      <div className="login__frame panel">
        <div className="login__brand">
          <Wordmark height={30} />
          <span className="micro login__sub">Control Center · accès restreint</span>
        </div>
        <form onSubmit={submit} className="login__form" noValidate>
          <Field label="Identifiant" required>
            <input className="input input--mono" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus value={user} onChange={(e) => setUser(e.target.value)} />
          </Field>
          <Field label="Mot de passe" required>
            <input className="input input--mono" name="password" type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} />
          </Field>
          {error && <Banner tone="err">{error}</Banner>}
          <Button type="submit" variant="primary" busy={busy} disabled={!user.trim() || !pass}>Se connecter</Button>
        </form>
        <p className="login__foot micro">Plateforme auto-hébergée · session chiffrée</p>
      </div>
    </main>
  );
}
