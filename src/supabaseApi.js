import { createClient } from '@supabase/supabase-js';

let client;
function supabase() {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase is not configured. Set the project URL and publishable key in the frontend build environment.');
  client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  client.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') window.dispatchEvent(new Event('studio:unauthorized')); });
  return client;
}
function checked(result) { if (result.error) throw result.error; return result.data; }
async function invoke(path, body) {
  const result = await supabase().functions.invoke('workspace-api', { body: { path, method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body }) } });
  if (result.error) {
    let details = {};
    try { details = await result.error.context.json(); } catch {}
    const error = Object.assign(new Error(details.error || result.error.message), details);
    if (result.error.context?.status === 401 || (result.error.context?.status === 403 && /account is not authorized/.test(error.message))) {
      if (!error.requiresTwoFactor) await supabase().auth.signOut({ scope: 'local' });
    }
    throw error;
  }
  return result.data;
}

export async function supabaseApi(path, body) {
  const sdk = supabase();
  if (path === '/auth/register') throw new Error('Public registration is disabled. Contact management.');
  if (path === '/auth/logout') { checked(await sdk.auth.signOut()); return { ok: true }; }
  if (path === '/auth/login') {
    checked(await sdk.auth.signInWithPassword({ email: body.email, password: body.password }));
    const factors = checked(await sdk.auth.mfa.listFactors());
    if (factors.totp.length) {
      if (!body.code) throw Object.assign(new Error('Enter your authenticator code.'), { requiresTwoFactor: true });
      checked(await sdk.auth.mfa.challengeAndVerify({ factorId: factors.totp[0].id, code: body.code }));
    }
    return invoke('/auth');
  }
  if (path === '/auth') {
    const { session } = checked(await sdk.auth.getSession());
    if (!session) return { user: null, setupRequired: false };
    const assurance = checked(await sdk.auth.mfa.getAuthenticatorAssuranceLevel());
    if (assurance.nextLevel === 'aal2' && assurance.currentLevel !== 'aal2') return { user: null, setupRequired: false };
    return invoke('/auth');
  }
  if (path === '/auth/2fa/setup') {
    const factors = checked(await sdk.auth.mfa.listFactors());
    if (factors.totp.length) throw new Error('Two-factor authentication is already enabled.');
    for (const factor of factors.all.filter(item => item.status === 'unverified')) checked(await sdk.auth.mfa.unenroll({ factorId: factor.id }));
    const factor = checked(await sdk.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Draft Studio authenticator' }));
    return { secret: factor.totp.secret, qr: factor.totp.qr_code.startsWith('data:') ? factor.totp.qr_code : `data:image/svg+xml;utf8,${encodeURIComponent(factor.totp.qr_code)}` };
  }
  if (path === '/auth/2fa/verify') {
    const factors = checked(await sdk.auth.mfa.listFactors());
    const pending = factors.all.find(factor => factor.factor_type === 'totp' && factor.status === 'unverified');
    if (!pending) throw new Error('Start authenticator setup first.');
    checked(await sdk.auth.mfa.challengeAndVerify({ factorId: pending.id, code: body.code }));
    return invoke('/auth');
  }
  return invoke(path, body);
}