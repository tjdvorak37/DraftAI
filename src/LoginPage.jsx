import { useState } from 'react';
import { ArrowRight, LoaderCircle, LockKeyhole, ShieldCheck, Warehouse } from 'lucide-react';
import { api } from './client.js';

export default function LoginPage({ onSuccess, setupRequired = false, loading = false, unavailable = false, onRetry }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [twoFactor, setTwoFactor] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { const result = await api('/auth/login', Object.fromEntries(new FormData(event.currentTarget))); onSuccess(result.user); }
    catch (error) { setError(error.message); if (error.requiresTwoFactor) setTwoFactor(true); }
    finally { setBusy(false); }
  }
  return <main className="login-page">
    <section className="login-identity"><a className="brand" href="/" aria-label="Accu-Steel Draft Studio"><span className="brand-symbol"><Warehouse size={24} /></span><div><span className="brand-name">ACCU-STEEL</span><span className="brand-subtitle">DRAFT STUDIO</span></div></a><div className="login-structure" aria-hidden="true"><Warehouse size={170} strokeWidth={0.7} /></div><div className="login-location"><span>AUDUBON, IOWA</span><span>BUILT TO ENDURE.</span></div></section>
    <section className="login-form-section"><div className="login-form-content"><span className="login-eyebrow"><LockKeyhole size={13} /> PRIVATE WORKSPACE</span><h1>Sign in</h1><p className="login-subtitle">Accu-Steel Draft Studio</p>
      {loading ? <div className="login-state" role="status"><LoaderCircle size={20} className="spin" /> Checking your session…</div> : unavailable ? <div className="form-stack"><p className="form-error" role="alert">The workspace server is unavailable. Access remains locked.</p><button className="button" onClick={onRetry}>Retry connection</button></div> : <form className="form-stack" onSubmit={submit}>
        <label>Work email<input name="email" type="email" autoComplete="username" required placeholder="you@accusteel.com" /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" required maxLength={72} placeholder="Your password" /></label>
        {twoFactor && <label>Authenticator code<input name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" required autoFocus /></label>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button primary full" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <ArrowRight size={16} />} Sign in</button>
        <p className="login-access-note"><ShieldCheck size={16} /><span>Access is assigned by management. Contact your administrator for an account or password assistance.</span></p>
        {setupRequired && <p className="login-setup-note">This workspace has not been activated. An authorized operator must provision the first administrator from the server terminal.</p>}
      </form>}
      <footer className="login-copyright">ACCU-STEEL · AUTHORIZED PERSONNEL ONLY</footer>
    </div></section>
  </main>;
}