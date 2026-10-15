// E2E: bloco Presidente 2026 em "Mais votados no seu bairro" (grátis × assinante, Pixel e iPhone com notch).
const { chromium, devices } = require('/workspace/eleicoes-se/assinaturas/api/test/sem-analytics.cjs')(require('/workspace/eleicoes-se/build/node_modules/playwright-core'));
const fs = require('fs');
const API = 'http://localhost:8787';
const LIVE = !!process.env.BASE && !/localhost/.test(process.env.BASE);   // produção: só a parte grátis (leitura)
const SITE = LIVE ? process.env.BASE : 'http://localhost:8080/?api=http://localhost:8787&dados=http://127.0.0.1:8766';
const OUT = process.env.OUT || '/workspace/eleicoes-se/rebrand/bairro/presidente'; fs.mkdirSync(OUT, { recursive: true });
const ADMIN_TOKEN = (fs.readFileSync(__dirname + '/../.dev.vars', 'utf8').match(/^ADMIN_TOKEN=(.*)$/m) || [])[1];
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0, total = 0;
const ok = (n, c, info) => { total++; if (!c) fails++; console.log((c ? '✔ ' : '✘ ') + n + (c ? '' : ' → ' + String(JSON.stringify(info)).slice(0, 400))); };
const L = {
  farolandia: { latitude: -10.96921, longitude: -37.05912, uf: 'se', cd: '31054', b: 'FAROLANDIA', re: /Farol[aâ]ndia/i },
  copacabana: { latitude: -22.9711, longitude: -43.1822, uf: 'rj', cd: '60011', b: 'COPACABANA', re: /Copacabana/i, t2gov: true },
  vilamariana: { latitude: -23.58902, longitude: -46.63421, uf: 'sp', cd: '71072', b: 'VILA MARIANA', re: /Vila Mariana/i },
};
const DEV = { pixel: [devices['Pixel 7'], null], iphone: [devices['iPhone 14 Pro Max'], { top: 59, topMax: 59, bottom: 34, bottomMax: 34 }] };
const tse = [];
async function abrir(browser, dev, insets, geo, ctxOld) {
  const ctx = ctxOld || await browser.newContext({ ...dev, serviceWorkers: 'block', geolocation: { latitude: geo.latitude, longitude: geo.longitude, accuracy: 30 }, permissions: ['geolocation'] });
  const page = await ctx.newPage(); const erros = []; page.on('pageerror', e => erros.push(e.message));
  const ip = `10.78.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  if (!LIVE) await page.route(API + '/**', r => r.continue({ headers: { ...r.request().headers(), 'cf-connecting-ip': ip } }));
  page.on('request', r => { if (/tse\.jus\.br/.test(new URL(r.url()).hostname)) tse.push(r.url()); });
  if (insets) { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { left: 0, leftMax: 0, right: 0, rightMax: 0, ...insets } }); }
  await page.goto(SITE, { waitUntil: 'load' }); await page.waitForSelector('#cmv-entrar', { timeout: 20000 });
  return { ctx, page, erros };
}
async function resultado(page) {
  await page.evaluate(() => { location.hash = '#planos'; }); await page.waitForTimeout(300); await page.evaluate(() => { location.hash = '#bairro'; });
  await page.waitForSelector('#bx-consent, #bx-c1', { timeout: 15000 });
  if (await page.locator('#bx-consent [data-bx=geo]').count()) await page.click('#bx-consent [data-bx=geo]');
  await page.waitForSelector('#bx-c1 .bx-lista li', { timeout: 30000 }); await page.waitForTimeout(1500);
}
async function cadastrar(page, email) {
  await page.click('#cmv-entrar'); await page.click('.cmv-tabs button[data-tab=cadastro]');
  const f = page.locator('form[data-form=cadastro]');
  await f.locator('input[name=nome]').fill('Teste Presidente'); await f.locator('input[name=email]').fill(email);
  await f.locator('input[name=cidade]').fill('Aracaju'); await f.locator('select[name=uf]').selectOption('se');
  await f.locator('select[name=perfil]').selectOption('campanha'); await f.locator('input[name=aceite_termos]').check();
  await f.locator('button[type=submit]').click(); await page.waitForSelector('form[data-form=codigo]:not([hidden])', { timeout: 10000 }).catch(async e => { console.log('MODAL:', await page.textContent('#cmv-modal').catch(() => '?')); throw e; });
  let cod = null;
  for (let i = 0; i < 20 && !cod; i++) { const j = await (await fetch(`${API}/__dev/outbox?to=${encodeURIComponent(email)}`)).json(); const m = j.emails.length && j.emails[j.emails.length - 1].text.match(/\b(\d{6})\b/); cod = m && m[1]; if (!cod) await sleep(300); }
  await page.fill('form[data-form=codigo] input[name=codigo]', cod); await page.waitForSelector('#cmv-modal', { state: 'detached', timeout: 10000 });
  const me = await (await fetch(`${API}/admin/usuarios?q=${encodeURIComponent(email)}`, { headers: { Authorization: 'Bearer ' + ADMIN_TOKEN, Origin: 'http://localhost:8080' } })).json();
  const id = me.usuarios[0].id;
  const g = await fetch(`${API}/admin/usuarios/${id}/cortesia`, { method: 'POST', headers: { Authorization: 'Bearer ' + ADMIN_TOKEN, 'Content-Type': 'application/json', Origin: 'http://localhost:8080' }, body: JSON.stringify({ dias: 30, motivo: 'e2e presidente' }) });
  return g.status;
}
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  for (const [lk, lu] of Object.entries(L)) {
    const livre = JSON.parse(fs.readFileSync(`/workspace/m2024/out/proposta/e2026/${lu.uf}/top3-livre/${lu.cd}.json`, 'utf8'));
    const pro = JSON.parse(fs.readFileSync(`/workspace/m2024/out/pro/e2026/${lu.uf}/top3/${lu.cd}.json`, 'utf8'));
    const bi = livre.bairros.indexOf(lu.b); const src = bi >= 0 && livre.top[bi].ok ? livre.top[bi] : livre.mun;
    const esperado = src['1'].map(i => livre.c[i][1].toUpperCase());
    for (const [dk, [dev, insets]] of Object.entries(DEV)) {
      const tag = `${lk}/${dk}`;
      const { ctx, page, erros } = await abrir(browser, dev, insets, lu);
      await resultado(page);
      ok(`${tag}: bairro`, lu.re.test(await page.textContent('#view-bairro h1')));
      const ids = await page.$$eval('#view-bairro section.bx-sec', s => s.map(x => x.id));
      const i1 = ids.indexOf('bx-c1');
      ok(`${tag}: ordem Presidente, Governador, Senador, Dep. Federal, Dep. Estadual`, i1 >= 0 && ids.slice(i1, i1 + 5).join() === 'bx-c1,bx-c3,bx-c5,bx-c6,bx-c7', ids);
      const gEsp = src['3'].map(i => livre.c[i][1].toUpperCase());
      const gNomes = await page.$$eval('#bx-c3 > .bx-lista li .bx-nome strong', a => a.map(x => x.textContent.toUpperCase()));
      ok(`${tag}: Governador top 3 igual ao arquivo, com "Mostrar votos"`, gNomes.length === 3 && gNomes.every((n, i) => n === gEsp[i]) && (await page.locator('#bx-c3 [data-bx-votos]:visible').count()) === 3, [gNomes, gEsp]);
      const gSit = src['3'].map(i => livre.c[i][6]);
      ok(`${tag}: selos de Governador conforme TSE`, (await page.locator('#bx-c3 > .bx-lista .bx-badge.ok').count()) === gSit.filter(x => x === 'e').length && (await page.locator('#bx-c3 > .bx-lista .bx-badge.t2').count()) === gSit.filter(x => x === '2t').length, gSit);
      const nomes = await page.$$eval('#bx-c1 > .bx-lista li .bx-nome strong', a => a.map(x => x.textContent.toUpperCase()));
      ok(`${tag}: grátis top 3 Presidente igual ao arquivo`, nomes.length === 3 && nomes.every((n, i) => n === esperado[i]), [nomes, esperado]);
      const tx = await page.textContent('#bx-c1');
      ok(`${tag}: selo "Vai ao 2º turno" e nunca "Eleito" em Presidente`, /Vai ao 2º turno/.test(tx) && (await page.locator('#bx-c1 .bx-badge.ok').count()) === 0);
      if (lu.t2gov) ok(`${tag}: Governador RJ: "Vai ao 2º turno" e nenhum "Eleito"`, (await page.locator('#bx-c3 .bx-badge.t2').count()) >= 1 && (await page.locator('#bx-c3 .bx-badge.ok').count()) === 0 && /2º turno é em 25\/10\/2026/.test(await page.textContent('#bx-c3')));
      ok(`${tag}: aviso 2º turno em 25/10`, /2º turno é em 25\/10\/2026/.test(tx));
      ok(`${tag}: "Mostrar votos" em cada candidato, sem votos`, (await page.locator('#bx-c1 [data-bx-votos]:visible').count()) === 3 && (await page.locator('#bx-c1 .bx-votos').count()) === 0);
      ok(`${tag}: fotos de Presidente carregadas`, (await page.evaluate(() => [...document.querySelectorAll('#bx-c1 .bx-foto img')].filter(i => i.naturalWidth > 0).length)) === 3);
      ok(`${tag}: sem rolagem horizontal`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.locator('#bx-c1').scrollIntoViewIfNeeded(); await page.evaluate(() => scrollBy(0, -80)); await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${dk}-${lk}-gratis.png` });
      ok(`${tag}: sem erros de JS (grátis)`, erros.length === 0, erros);
      if (LIVE) { await ctx.close(); continue; }
      // assinante
      const st = await cadastrar(page, `pres-${lk}-${dk}-${Date.now().toString(36)}@teste.local`);
      ok(`${tag}: cortesia`, st === 200, st);
      await page.evaluate(() => window.CMV.refresh()); await page.waitForFunction(() => window.CMV.pro(), null, { timeout: 10000 });
      await resultado(page);
      await page.waitForSelector('#bx-c1 .bx-votos', { timeout: 20000 }).catch(() => {});
      const tx2 = await page.textContent('#bx-c1');
      ok(`${tag}: assinante votos e % em Presidente`, (await page.locator('#bx-c1 .bx-votos').count()) >= 3 && /\d+,\d%/.test(tx2));
      const tb = pro.top.findIndex(x => x.b === pro.bairros.indexOf(lu.b));
      const B = tb >= 0 ? pro.top[tb]['1'] : pro.mun['1'];
      const v1 = (await page.locator('#bx-c1 .bx-votos strong').first().textContent()).replace(/\D/g, '');
      ok(`${tag}: 1º votos igual ao arquivo privado`, Number(v1) === B.rk[0][1], [v1, B.rk[0]]);
      ok(`${tag}: ranking completo Presidente`, /Ranking \(\d+ mais votados\)/.test(tx2));
      ok(`${tag}: assinante sem "Eleito" em Presidente e sem cadeados`, (await page.locator('#bx-c1 .bx-badge.ok').count()) === 0 && (await page.locator('[data-bx-votos]').count()) === 0);
      await page.locator('#bx-c1').scrollIntoViewIfNeeded(); await page.evaluate(() => scrollBy(0, -80)); await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${dk}-${lk}-assinante.png` });
      await page.evaluate(() => { const d = document.querySelector('#bx-c1 details'); if (d) d.open = true; });
      await page.locator('#bx-c1').screenshot({ path: `${OUT}/${dk}-${lk}-assinante-ranking.png` });
      ok(`${tag}: sem erros de JS (assinante)`, erros.length === 0, erros);
      await ctx.close();
    }
  }
  ok('zero pedidos ao TSE', tse.length === 0, tse);
  await browser.close();
  console.log(`\n${total - fails}/${total} ok`); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
