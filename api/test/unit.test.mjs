// Testes unitários (Node): Turnstile com as chaves de TESTE oficiais da Cloudflare, envio de e-mail com fallback, modelo do e-mail.
import { verifyTurnstile } from '../src/lib/turnstile.js';
import { enviarEmail, DEV_OUTBOX } from '../src/email/send.js';
import { emailCodigo } from '../src/email/templates.js';
import { mesBRT, proximoMesBRT } from '../src/lib/plan.js';
let f = 0, n = 0;
const check = (nome, c, info) => { n++; if (!c) f++; console.log(`${c ? '✔' : '✘'} ${nome}${c ? '' : ' → ' + JSON.stringify(info)}`); };
// Chaves de teste documentadas: 1x...AA sempre passa; 2x...AA sempre falha.
const PASS = '1x0000000000000000000000000000000AA', FAIL = '2x0000000000000000000000000000000AA';
check('Turnstile desligado (dev) → passa sem chamar a Cloudflare', (await verifyTurnstile({ TURNSTILE_REQUIRED: '0' }, null)).skipped === true);
check('Turnstile ligado sem token → bloqueia', (await verifyTurnstile({ TURNSTILE_REQUIRED: '1', TURNSTILE_SECRET: PASS }, '')).ok === false);
const p = await verifyTurnstile({ TURNSTILE_REQUIRED: '1', TURNSTILE_SECRET: PASS }, 'XXXX.DUMMY.TOKEN.XXXX');
check('Turnstile chave de teste “sempre passa” → ok (siteverify real)', p.ok === true, p);
const q = await verifyTurnstile({ TURNSTILE_REQUIRED: '1', TURNSTILE_SECRET: FAIL }, 'XXXX.DUMMY.TOKEN.XXXX');
check('Turnstile chave de teste “sempre falha” → bloqueia', q.ok === false, q);
// e-mail: principal Cloudflare indisponível → fallback
const base = { EMAIL_FROM_ADDR: 'acesso@cademeuvoto.com.br', EMAIL_FROM_NAME: 'Cadê Meu Voto' };
const m = { to: 'a@b.com', subject: 's', text: 't', html: '<p>t</p>' };
const r1 = await enviarEmail({ ...base, EMAIL_PROVIDER: 'cloudflare', EMAIL_FALLBACK: 'mock' }, m);
check('Cloudflare falha (sem binding) → cai no fallback', r1.provider === 'mock' && DEV_OUTBOX.length === 1);
let sent;
const r2 = await enviarEmail({ ...base, EMAIL_PROVIDER: 'cloudflare', EMAIL: { send: async x => { sent = x; return { messageId: 'm1' }; } } }, m);
check('Cloudflare Email Service: from com nome, to, subject, html, text', r2.provider === 'cloudflare' && sent.from.email === base.EMAIL_FROM_ADDR && sent.from.name === 'Cadê Meu Voto' && sent.to === 'a@b.com' && sent.html && sent.text);
const realFetch = globalThis.fetch; let resendBody;
globalThis.fetch = async (url, init) => { resendBody = { url, auth: init.headers.Authorization, body: JSON.parse(init.body) }; return new Response('{"id":"re_1"}', { status: 200 }); };
const r3 = await enviarEmail({ ...base, EMAIL_PROVIDER: 'cloudflare', EMAIL_FALLBACK: 'resend', RESEND_API_KEY: 're_test_dummy' }, m);
globalThis.fetch = realFetch;
check('fallback Resend: POST api.resend.com/emails com remetente formatado', r3.provider === 'resend' && resendBody.url === 'https://api.resend.com/emails' && resendBody.body.from === 'Cadê Meu Voto <acesso@cademeuvoto.com.br>');
let erro = null;
try { await enviarEmail({ ...base, EMAIL_PROVIDER: 'cloudflare', EMAIL_FALLBACK: 'resend' }, m); } catch (e) { erro = e; }
check('sem binding e sem chave Resend → erro (não finge que enviou)', !!erro);
const e = emailCodigo({ nome: 'Ana Souza', codigo: '012345', finalidade: 'cadastro' });
check('modelo: assunto, saudação pelo 1º nome, código, validade', e.subject === 'Seu código de acesso: 012345' && /Olá, Ana!/.test(e.text) && /012345/.test(e.html) && /10 minutos/.test(e.text) && /lang="pt-BR"/.test(e.html));
check('modelo: escapa HTML no nome', !/<script>/.test(emailCodigo({ nome: '<script>x', codigo: '1' }).html));
// ciclo mensal em BRT
const t = Date.UTC(2026, 9, 1, 2, 30); // 01/10 02:30 UTC = 30/09 23:30 BRT
check('ciclo grátis usa o mês de Brasília (30/09 23:30 BRT ainda é setembro)', mesBRT(t).key === '2026-09' && proximoMesBRT(t) === Date.UTC(2026, 9, 1, 3) / 1000);

// ---- contador anônimo de visitantes (classificarVisita é pura)
{
  const { classificarVisita, diaBRT } = await import('../src/lib/visitas.js');
  const P = q => new URLSearchParams(q);
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const c = (q, cf, extra = {}) => classificarVisita({ params: P(q), ua: UA, cf, originOk: true, ...extra });
  const se = { country: 'BR', regionCode: 'SE', colo: 'GRU', asn: 28573 };
  check('visita: 1º acesso do dia em SE → BR-SE, visitante 1', JSON.stringify(c('visita=1', se)) === '{"local":"BR-SE","visitante":1}');
  check('visita: outra abertura → acesso sem visitante', JSON.stringify(c('acesso=1', se)) === '{"local":"BR-SE","visitante":0}');
  check('visita: /me sem marca (refresh interno) → não conta', c('', se) === null);
  check('visita: sem Origin do site → não conta', c('visita=1', se, { originOk: false }) === null);
  check('visita: navigator.webdriver (wd=1) → _teste', c('visita=1&wd=1', se).local === '_teste');
  check('visita: HeadlessChrome → _teste', classificarVisita({ params: P('visita=1'), ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.0.0 Safari/537.36', cf: se, originOk: true }).local === '_teste');
  check('visita: sem User-Agent / curl → _teste', classificarVisita({ params: P('visita=1'), ua: '', cf: se, originOk: true }).local === '_teste' && classificarVisita({ params: P('visita=1'), ua: 'curl/8.5', cf: se, originOk: true }).local === '_teste');
  check('visita: "Brasil" atendido em IAD (saída dos testes) → _teste', c('visita=1', { country: 'BR', regionCode: 'SE', colo: 'IAD', asn: 13335 }).local === '_teste');
  check('visita: WARP (AS13335) em IAD → _teste', c('visita=1', { country: 'US', regionCode: 'VA', colo: 'IAD', asn: 13335 }).local === '_teste');
  check('visita: WARP/iCloud Relay fora de IAD conta normalmente', c('visita=1', { country: 'BR', regionCode: 'SP', colo: 'GRU', asn: 13335 }).local === 'BR-SP');
  check('visita: celular Cubot não é robô', classificarVisita({ params: P('visita=1'), ua: 'Mozilla/5.0 (Linux; Android 12; Cubot X50) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36', cf: se, originOk: true }).local === 'BR-SE');
  check('visita: Brasil sem estado → BR-??', c('visita=1', { country: 'BR', colo: 'GRU' }).local === 'BR-??');
  check('visita: exterior agrupado por país', c('visita=1', { country: 'PT', regionCode: '11', colo: 'LIS' }).local === 'PT');
  check('visita: país inválido/Tor → ??', c('visita=1', { country: 'T1', colo: 'FRA' }).local === '??' && c('visita=1', {}).local === '??');
  check('visita: dia em BRT (02:59 UTC ainda é o dia anterior)', diaBRT(Date.UTC(2026, 9, 8, 2, 59)) === '2026-10-07' && diaBRT(Date.UTC(2026, 9, 8, 3, 0)) === '2026-10-08');
}
console.log(`\n${n - f}/${n} verificações OK`);
process.exit(f ? 1 : 0);
