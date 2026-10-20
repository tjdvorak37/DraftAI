import { useState } from 'react';
import { Save } from 'lucide-react';
import { api } from './client.js';
import { Modal } from './ui.jsx';

export function UserProfileFields({ user = {}, includeIdentity = false }) {
  return <>
    {includeIdentity && <><label>Full name<input name="name" defaultValue={user.name} required minLength={2} maxLength={80} autoComplete="name" /></label><label>Work email<input name="email" type="email" defaultValue={user.email} required autoComplete="email" /></label></>}
    <label>Address<textarea aria-label="Address" name="address" defaultValue={user.address || ''} maxLength={500} rows={2} autoComplete="street-address" /></label>
    <div className="form-grid"><label>Phone number<input name="phone" type="tel" defaultValue={user.phone || ''} maxLength={40} autoComplete="tel" /></label><label>Department<input name="department" defaultValue={user.department || ''} maxLength={80} /></label></div>
    <label>Job title<input name="jobTitle" defaultValue={user.jobTitle || ''} maxLength={80} /></label>
  </>;
}

export default function UserProfileForm({ user, onClose, onSaved }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { const result = await api(`/users/${user.id}/profile`, Object.fromEntries(new FormData(event.currentTarget))); await onSaved(result); }
    catch (error) { setError(error.message); } finally { setBusy(false); }
  }
  return <Modal title="User profile" subtitle="Management-controlled contact and employment details." onClose={onClose}><form className="form-stack" onSubmit={submit}><UserProfileFields user={user} includeIdentity /><p className="muted">Changing the sign-in email revokes this user’s sessions. Address and phone details are not shared with other staff.</p>{error && <p className="form-error" role="alert">{error}</p>}<button className="button primary" disabled={busy}><Save size={15} /> Save profile</button></form></Modal>;
}