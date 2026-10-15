// Envio de e-mail atrás de uma interface única: enviarEmail(env, msg).
// Motores: 'cloudflare' (Email Service, binding EMAIL), 'resend' (API), 'mock' (só loga; dev/testes).
export const DEV_OUTBOX = [];   // apenas para o motor mock (memória do isolate local)

async function viaCloudflare(env, m) {
  if (!env.EMAIL || typeof env.EMAIL.send !== 'function') throw new Error('binding EMAIL ausente');
  const r = await env.EMAIL.send({
    to: m.to,
    from: { email: env.EMAIL_FROM_ADDR, name: env.EMAIL_FROM_NAME || 'Cadê Meu Voto' },
    replyTo: env.EMAIL_REPLY_TO || undefined,
    subject: m.subject, text: m.text, html: m.html,
  });
  return { provider: 'cloudflare', id: r && r.messageId };
}
async function viaResend(env, m) {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY ausente');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${env.EMAIL_FROM_NAME || 'Cadê Meu Voto'} <${env.EMAIL_FROM_ADDR}>`,
      to: [m.to], reply_to: env.EMAIL_REPLY_TO || undefined,
      subject: m.subject, text: m.text, html: m.html,
    }),
  });
  if (!r.ok) throw new Error('resend ' + r.status);
  const d = await r.json().catch(() => ({}));
  return { provider: 'resend', id: d.id };
}
async function viaMock(env, m) {
  const item = { to: m.to, subject: m.subject, text: m.text, meta: m.meta || {}, em: Date.now() };
  DEV_OUTBOX.push(item); if (DEV_OUTBOX.length > 200) DEV_OUTBOX.shift();
  console.log(`[email:mock] para=${m.to} assunto="${m.subject}"`);
  return { provider: 'mock' };
}
const MOTORES = { cloudflare: viaCloudflare, resend: viaResend, mock: viaMock };

export async function enviarEmail(env, msg) {
  const principal = MOTORES[env.EMAIL_PROVIDER] ? env.EMAIL_PROVIDER : 'cloudflare';
  try { return await MOTORES[principal](env, msg); }
  catch (e) {
    const fb = env.EMAIL_FALLBACK;
    if (fb && fb !== principal && MOTORES[fb] && (fb !== 'resend' || env.RESEND_API_KEY)) {
      console.warn(`[email] ${principal} falhou (${e.message}); tentando ${fb}`);
      return MOTORES[fb](env, msg);
    }
    throw e;
  }
}
