// Prints limpos para revisão: modal de login, Minha conta (grátis e assinante) e avisos de paywall. Tudo local.
const { chromium } = require('/workspace/eleicoes-se/assinaturas/api/test/sem-analytics.cjs')(require('/workspace/eleicoes-se/build/node_modules/playwright-core'));
const fs = require('fs');
const API = 'http://localhost:8787', SITE = 'http://localhost:8080/?api=' + API + '&dados=http://127.0.0.1:8766', OUT = __dirname + '/out';
const ADMIN = (fs.readFileSync(__dirname + '/../.dev.vars', 'utf8').match(/^ADMIN_TOKEN=(.*)$/m) || [])[1];
const adm = (p, body) => fetch(API + p, { method: 'POST', headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then(r => r.json());
async function entrar(page, email) {
  await page.goto(SITE, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('#cmv-entrar'); await page.click('#cmv-entrar');
  const f = page.locator('form[data-form=entrar]'); await f.locator('[name=email]').fill(email);
  await page.screenshot({ path: OUT + '/preview-login-entrar.png' });
  await f.locator('button[type=submit]').click(); await page.waitForSelector('form[data-form=codigo]:not([hidden])');
  let cod; for (let i = 0; i < 20 && !cod; i++) { const j = await (await fetch(`${API}/__dev/outbox?to=${encodeURIComponent(email)}`)).json(); const m = j.emails.length && j.emails.at(-1).text.match(/\b(\d{6})\b/); cod = m && m[1]; if (!cod) await page.waitForTimeout(300); }
  await page.screenshot({ path: OUT + '/preview-login-codigo.png' });
  await page.fill('form[data-form=codigo] input[name=codigo]', cod);
  await page.waitForFunction(() => window.CMV && window.CMV.logado());
}
(async () => {
  await fetch(API + '/__dev/reset-limites', { method: 'POST' });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const run = Date.now().toString(36);
  for (const tipo of ['gratis', 'assinante']) {
    const email = `preview-${tipo}-${run}@teste.local`;
    const u = await adm('/admin/usuarios', { email, nome: tipo === 'gratis' ? 'Joana Grátis' : 'Carlos Assinante', uf: 'se', perfil: 'imprensa' });
    if (tipo === 'assinante') await adm(`/admin/usuarios/${u.id}/cortesia`, { dias: 30, motivo: 'preview' });
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    await entrar(page, email);
    await page.goto(SITE + '#conta'); await page.waitForSelector('#view-conta .cmv-conta'); await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/preview-conta-${tipo}.png`, fullPage: true });
    if (tipo === 'gratis') {
      // paywall no mapa (município → aviso) e no Excel dos relatórios
      await page.goto(SITE + '#mapa'); await page.waitForTimeout(2500);
      const pw = page.locator('.cmv-paywall').first(); await pw.waitFor({ timeout: 15000 }); await pw.scrollIntoViewIfNeeded();
      await page.screenshot({ path: OUT + '/preview-paywall-mapa.png' });
      await page.goto(SITE + '#relatorios'); await page.waitForTimeout(1500);
      const xl = page.locator('button:has-text("Excel")').first();
      if (await xl.count()) { await xl.click(); await page.waitForSelector('#cmv-modal', { timeout: 5000 }).catch(() => {}); await page.screenshot({ path: OUT + '/preview-paywall-excel.png' }); }
    }
  }
  await browser.close(); console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
