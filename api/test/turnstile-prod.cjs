// Teste positivo do Turnstile em PRODUÇÃO sem publicar nada: o navegador local "vê" https://cademeuvoto.com.br,
// mas o HTML/JS vem da branch local `assinaturas` (interceptado). A API é a de produção.
// Pede código para um e-mail que NÃO tem conta → nenhum e-mail é enviado.
const { chromium } = require('/workspace/eleicoes-se/assinaturas/api/test/sem-analytics.cjs')(require('/workspace/eleicoes-se/build/node_modules/playwright-core'));
const fs = require('fs'), path = require('path');
const SITE_DIR = '/workspace/eleicoes-se/site';
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: process.env.HEADED ? false : true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.route(/^https:\/\/cademeuvoto\.com\.br\//, async route => {
    let p = new URL(route.request().url()).pathname; if (p.endsWith('/')) p += 'index.html';
    const f = path.join(SITE_DIR, decodeURIComponent(p));
    if (!f.startsWith(SITE_DIR) || !fs.existsSync(f)) return route.fulfill({ status: 404, body: 'nao achei' });
    route.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  const page = await ctx.newPage();
  const respostas = [];
  page.on('response', r => { if (r.url().startsWith('https://api.cademeuvoto.com.br/auth/')) respostas.push(r); });
  await page.goto('https://cademeuvoto.com.br/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#cmv-entrar', { timeout: 20000 });
  await page.click('#cmv-entrar');
  const f = page.locator('form[data-form=entrar]');
  await f.locator('input[name=email]').fill('teste-turnstile-sem-conta@example.com');
  // espera o token do Turnstile (campo escondido que o widget cria)
  let token = '';
  await page.waitForTimeout(4000);
  const box = await f.locator('.cmv-ts').boundingBox();
  if (box) { await page.mouse.move(box.x + 10, box.y + 10); await page.mouse.click(box.x + 16, box.y + box.height / 2, { delay: 80 }); }
  for (let i = 0; i < 60 && !token; i++) { await page.waitForTimeout(500); token = await page.evaluate(() => (document.querySelector('form[data-form=entrar] [name="cf-turnstile-response"]') || {}).value || ''); }
  await page.screenshot({ path: __dirname + '/out/turnstile-prod-widget.png' });
  console.log('token do widget:', token ? 'recebido (' + token.length + ' chars)' : 'NÃO recebido');
  await f.locator('button[type=submit]').click();
  await page.waitForTimeout(4000);
  for (const r of respostas) console.log(r.request().method(), r.url(), r.status(), JSON.stringify(await r.json().catch(() => ({}))));
  console.log('mensagem:', await f.locator('.cmv-msg').textContent().catch(() => ''), '| tela código visível:', await page.locator('form[data-form=codigo]:not([hidden])').count());
  await page.screenshot({ path: __dirname + '/out/turnstile-prod-depois.png' });
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
