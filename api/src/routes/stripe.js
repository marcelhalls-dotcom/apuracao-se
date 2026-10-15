// Fase C — Stripe Billing. DESLIGADO até existir STRIPE_ENABLED=1 + segredos STRIPE_SECRET_KEY e STRIPE_WEBHOOK_SECRET.
import Stripe from 'stripe';
import { json, now, HttpError } from '../lib/http.js';

export function stripeOn(env) { return env.STRIPE_ENABLED === '1' && !!env.STRIPE_SECRET_KEY; }
function client(env) {
  return new Stripe(env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient(), maxNetworkRetries: 1 });
}
const cryptoProvider = Stripe.createSubtleCryptoProvider();

async function precoId(env, s) {
  const r = await s.prices.list({ lookup_keys: [env.STRIPE_PRICE_LOOKUP || 'cmv_mensal'], active: true, limit: 1 });
  if (!r.data.length) throw new HttpError(500, 'Preço da assinatura não configurado.');
  return r.data[0].id;
}
async function garantirCliente(env, s, u) {
  if (u.stripe_customer_id) return u.stripe_customer_id;
  const c = await s.customers.create({ email: u.email, name: u.nome, metadata: { usuario_id: u.id } },
    { idempotencyKey: 'cust-' + u.id });
  await env.DB.prepare('UPDATE usuarios SET stripe_customer_id = ?2 WHERE id = ?1 AND stripe_customer_id IS NULL').bind(u.id, c.id).run();
  return c.id;
}

/** POST /stripe/checkout */
export async function checkout(request, env, sess) {
  if (!stripeOn(env)) throw new HttpError(503, 'A assinatura on-line ainda não está disponível. Fale com acesso@cademeuvoto.com.br.', { motivo: 'stripe-desligado' });
  const u = sess.user;
  const ativa = await env.DB.prepare("SELECT 1 FROM assinaturas WHERE usuario_id = ?1 AND status IN ('active','trialing','past_due')").bind(u.id).first();
  if (ativa) throw new HttpError(409, 'Você já tem uma assinatura. Use "Gerenciar assinatura".', { motivo: 'ja-assinante' });
  const s = client(env);
  const customer = await garantirCliente(env, s, u);
  const price = await precoId(env, s);
  const cs = await s.checkout.sessions.create({
    mode: 'subscription',
    customer,
    client_reference_id: u.id,
    line_items: [{ price, quantity: 1 }],
    subscription_data: { metadata: { usuario_id: u.id } },
    metadata: { usuario_id: u.id },
    locale: 'pt-BR',
    allow_promotion_codes: false,
    billing_address_collection: 'auto',
    success_url: `${env.SITE_BASE}/#conta?assinatura=ok`,
    cancel_url: `${env.SITE_BASE}/#planos`,
  });
  return json(200, { url: cs.url });
}

/** POST /stripe/portal */
export async function portal(request, env, sess) {
  if (!stripeOn(env)) throw new HttpError(503, 'Gerenciamento on-line ainda não está disponível.', { motivo: 'stripe-desligado' });
  const u = sess.user;
  if (!u.stripe_customer_id) throw new HttpError(400, 'Você ainda não tem assinatura.');
  const p = await client(env).billingPortal.sessions.create({ customer: u.stripe_customer_id, return_url: `${env.SITE_BASE}/#conta`, locale: 'pt-BR' });
  return json(200, { url: p.url });
}

export async function cancelarAssinatura(env, subId) {
  if (!stripeOn(env)) return; // sem Stripe ligada não há assinatura real a cancelar
  await client(env).subscriptions.cancel(subId);
}

function periodo(sub) {
  const it = sub.items && sub.items.data && sub.items.data[0];
  return {
    ini: sub.current_period_start ?? (it && it.current_period_start) ?? null,
    fim: sub.current_period_end ?? (it && it.current_period_end) ?? null,
    price: it && it.price ? it.price.id : null,
  };
}

/** Aplica o estado de uma assinatura (respeitando a ordem dos eventos). */
export async function aplicarAssinatura(env, sub, eventoEm) {
  let usuarioId = sub.metadata && sub.metadata.usuario_id;
  const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer && sub.customer.id;
  if (!usuarioId && customer) {
    const u = await env.DB.prepare('SELECT id FROM usuarios WHERE stripe_customer_id = ?1').bind(customer).first();
    usuarioId = u && u.id;
  }
  if (!usuarioId) { console.warn('[stripe] assinatura sem usuário', sub.id); return 'sem-usuario'; }
  const ant = await env.DB.prepare('SELECT * FROM assinaturas WHERE stripe_subscription_id = ?1').bind(sub.id).first();
  if (ant && ant.evento_em > eventoEm) return 'fora-de-ordem';
  const p = periodo(sub);
  const t = now();
  const pastDue = sub.status === 'past_due' ? (ant && ant.past_due_desde ? ant.past_due_desde : eventoEm || t) : null;
  await env.DB.prepare(
    `INSERT INTO assinaturas (stripe_subscription_id, usuario_id, stripe_customer_id, status, price_id, periodo_inicio, periodo_fim, cancelar_no_fim, past_due_desde, evento_em, atualizado_em)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
     ON CONFLICT(stripe_subscription_id) DO UPDATE SET status=?4, price_id=?5, periodo_inicio=?6, periodo_fim=?7, cancelar_no_fim=?8, past_due_desde=?9, evento_em=?10, atualizado_em=?11`
  ).bind(sub.id, usuarioId, customer, sub.status, p.price, p.ini, p.fim, sub.cancel_at_period_end ? 1 : 0, pastDue, eventoEm, t).run();
  if (customer) await env.DB.prepare('UPDATE usuarios SET stripe_customer_id = ?2 WHERE id = ?1 AND stripe_customer_id IS NULL').bind(usuarioId, customer).run();
  return 'ok';
}

/** POST /stripe/webhook — assinatura verificada com constructEventAsync (Web Crypto). */
export async function webhook(request, env) {
  if (!env.STRIPE_WEBHOOK_SECRET) throw new HttpError(503, 'webhook desligado');
  const sig = request.headers.get('Stripe-Signature');
  if (!sig) throw new HttpError(400, 'sem assinatura');
  const body = await request.text();
  let event;
  try {
    event = await Stripe.webhooks.constructEventAsync(body, sig, env.STRIPE_WEBHOOK_SECRET, undefined, cryptoProvider);
  } catch (e) { throw new HttpError(400, 'assinatura inválida'); }
  const dup = await env.DB.prepare('SELECT 1 FROM stripe_eventos WHERE id = ?1').bind(event.id).first();
  if (dup) return json(200, { ok: true, duplicado: true });
  let resultado = 'ignorado';
  const o = event.data.object;
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
      resultado = await aplicarAssinatura(env, o, event.created);
      break;
    case 'checkout.session.completed':
      if (o.client_reference_id && o.customer) {
        await env.DB.prepare('UPDATE usuarios SET stripe_customer_id = ?2 WHERE id = ?1 AND stripe_customer_id IS NULL').bind(o.client_reference_id, o.customer).run();
      }
      if (o.subscription && stripeOn(env)) {
        const sub = await client(env).subscriptions.retrieve(typeof o.subscription === 'string' ? o.subscription : o.subscription.id);
        if (!sub.metadata || !sub.metadata.usuario_id) sub.metadata = { ...(sub.metadata || {}), usuario_id: o.client_reference_id };
        resultado = await aplicarAssinatura(env, sub, now()); // estado lido agora = mais recente
      } else resultado = 'vinculado';
      break;
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const subId = o.subscription || (o.parent && o.parent.subscription_details && o.parent.subscription_details.subscription);
      if (subId && stripeOn(env)) resultado = await aplicarAssinatura(env, await client(env).subscriptions.retrieve(subId), now());
      break;
    }
  }
  await env.DB.prepare('INSERT OR IGNORE INTO stripe_eventos (id, tipo, recebido_em) VALUES (?1,?2,?3)').bind(event.id, event.type, now()).run();
  return json(200, { ok: true, resultado });
}
