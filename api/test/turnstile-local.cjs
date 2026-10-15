// Fluxo completo de cadastro pelo site com Turnstile LIGADO (chaves de teste oficiais da Cloudflare, que sempre passam),
// API local em :8788 (siteverify real da Cloudflare), e-mail mock. Gera prints do modal.
const { chromium } = require('/workspace/eleicoes-se/assinaturas/api/test/sem-analytics.cjs')(require('/workspace/eleicoes-se/build/node_modules/playwright-core'));
const API = 'http://localhost:8788';
const SITE = 'http://localhost:8080/?api=' + API + '&dados=http://127.0.0.1:8766';
const OUT = __dirname + '/out';
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  const auth = []; page.on('response', r => { if (r.url().includes('/auth/')) auth.push(r); });
  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#cmv-entrar'); await page.click('#cmv-entrar');
  await page.click('.cmv-tabs button[data-tab=cadastro]');
  const f = page.locator('form[data-form=cadastro]');
  const email = 'ts-' + Date.now().toString(36) + '@teste.local';
  await f.locator('[name=nome]').fill('Maria Teste'); await f.locator('[name=email]').fill(email);
  await f.locator('[name=cidade]').fill('Aracaju'); await f.locator('[name=uf]').selectOption('se');
  await f.locator('[name=perfil]').selectOption('imprensa'); await f.locator('[name=aceite_termos]').check();
  let tok = ''; for (let i = 0; i < 40 && !tok; i++) { await page.waitForTimeout(500); tok = await page.evaluate(() => (document.querySelector('form[data-form=cadastro] [name="cf-turnstile-response"]') || {}).value || ''); }
  console.log('widget de teste deu token:', !!tok);
  await page.screenshot({ path: OUT + '/preview-login-modal.png' });
  await f.locator('button[type=submit]').click();
  await page.waitForSelector('form[data-form=codigo]:not([hidden])', { timeout: 10000 });
  for (const r of auth) console.log(r.request().method(), new URL(r.url()).pathname, r.status());
  let cod = null;
  for (let i = 0; i < 20 && !cod; i++) { const j = await (await fetch(`${API}/__dev/outbox?to=${encodeURIComponent(email)}`)).json(); const m = j.emails.length && j.emails.at(-1).text.match(/\b(\d{6})\b/); cod = m && m[1]; if (!cod) await page.waitForTimeout(300); }
  await page.screenshot({ path: OUT + '/preview-login-codigo.png' });
  await page.fill('form[data-form=codigo] input[name=codigo]', cod);
  await page.waitForFunction(() => window.CMV && window.CMV.logado(), null, { timeout: 10000 });
  console.log('logado após código:', await page.evaluate(() => window.CMV.logado()));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
