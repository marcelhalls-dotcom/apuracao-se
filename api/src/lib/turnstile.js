export async function verifyTurnstile(env, token, ip) {
  if (env.TURNSTILE_REQUIRED !== '1') return { ok: true, skipped: true };
  if (!env.TURNSTILE_SECRET) return { ok: false, motivo: 'turnstile-sem-segredo' };
  if (!token) return { ok: false, motivo: 'turnstile-ausente' };
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', String(token));
  if (ip) form.append('remoteip', ip);
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const d = await r.json();
    return { ok: !!d.success, motivo: (d['error-codes'] || []).join(',') };
  } catch { return { ok: false, motivo: 'turnstile-falha-rede' }; }
}
