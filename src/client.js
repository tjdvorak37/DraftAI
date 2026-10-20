export async function api(path, body) {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || 'Request failed.'); Object.assign(error, data); throw error; }
  return data;
}