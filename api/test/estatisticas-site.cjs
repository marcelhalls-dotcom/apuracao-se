// "Estatísticas do site" no navegador (site :8080 + API :8787 locais): marca de visita no /me, testes fora da contagem,
// página só para a conta administradora (local: admin@teste.local; produção: ADMIN_EMAILS = conta do Marcel).
// SEMEAR=1 → antes, grava números SIMULADOS no D1 LOCAL (30 dias) só para a captura de tela. Nunca toca produção.
const { chromium, devices } = require('/workspace/eleicoes-se/assinaturas/api/test/sem-analytics.cjs')(require('/workspace/eleicoes-se/build/node_modules/playwright-core'));
const fs = require('fs');
const { execFileSync } = require('child_process');
const API = 'http://localhost:8787', ORIGIN = 'http://localhost:8080';
const SITE = 'http://localhost:8080/?api=http://localhost:8787&dados=http://127.0.0.1:8766';
const OUT = process.env.OUT || __dirname + '/out/estatisticas';
fs.mkdirSync(OUT, { recursive: true });
const RUN = Date.now().toString(36);
let fails = 0; const res = [];
const ok = (nome, c, info) => { res.push({ nome, ok: !!c }); if (!c) fails++; console.log((c ? '✔ ' : '✘ ') + nome + (c ? '' : ' → ' + JSON.stringify(info))); };
const H = { Origin: ORIGIN };
const outboxCod = async em => { for (let i = 0; i < 20; i++) { const e = (await (await fetch(`${API}/__dev/outbox?to=${encodeURIComponent(em)}`)).json()).emails; const m = e.length && e[e.length - 1].text.match(/\b(\d{6})\b/); if (m) return m[1]; await new Promise(r => setTimeout(r, 300)); } };
async function loginCtx(ctx, em, nome) {
  await fetch(API + '/__dev/reset-limites', { method: 'POST', headers: H });
  let r = await ctx.request.post(API + '/auth/cadastro', { headers: H, data: { nome, email: em, uf: 'se', perfil: 'candidato', cidade: 'Aracaju', aceite_termos: true } });
  if (r.status() === 409 || r.status() === 400 || r.status() === 200 && (await r.json()).existente) r = await ctx.request.post(API + '/auth/codigo', { headers: H, data: { email: em } });
  for (let t = 0; t < 2 && r.status() === 429; t++) { console.log('… aguardando 65 s (intervalo entre códigos)'); await new Promise(z => setTimeout(z, 65000)); r = await ctx.request.post(API + '/auth/codigo', { headers: H, data: { email: em } }); }
  const v = await ctx.request.post(API + '/auth/verificar', { headers: H, data: { email: em, codigo: await outboxCod(em) } });
  if (!v.ok()) throw new Error('login ' + em + ' ' + v.status() + ' ' + await v.text());
}
const semear = () => {
  // números SIMULADOS (só D1 local): 30 dias, alguns estados e países
  const pesos = { SE: 60, BA: 14, AL: 12, SP: 9, PE: 6, CE: 4, RJ: 4, MG: 3, DF: 3, SC: 2, PI: 2, PR: 1, ES: 1, AM: 1, RS: 1, GO: 1, MA: 1, PB: 1, RN: 1 };
  const rows = [];
  for (let i = 29; i >= 0; i--) {
    const dia = new Date(Date.now() - 3 * 3600e3 - i * 86400e3).toISOString().slice(0, 10);
    const f = i === 0 ? 0.6 : 0.4 + (29 - i) / 29 * 1.2;
    for (const [uf, p] of Object.entries(pesos)) { const v = Math.round(p * f * (0.7 + ((i * 7 + uf.charCodeAt(0)) % 10) / 15)); if (v) rows.push(`('${dia}','BR-${uf}',${v},${Math.round(v * 2.3)})`); }
    if (i % 3 === 0) rows.push(`('${dia}','PT',1,2)`); if (i % 4 === 0) rows.push(`('${dia}','US',1,1)`); if (i % 5 === 0) rows.push(`('${dia}','BR-??',2,3)`);
    rows.push(`('${dia}','_teste',${20 + i % 7},${40 + i % 9})`);
  }
  const sql = 'DELETE FROM visitas_dia; INSERT INTO visitas_dia (dia, local, visitantes, acessos) VALUES ' + rows.join(',') + ';';
  execFileSync('./node_modules/.bin/wrangler', ['d1', 'execute', 'cademeuvoto', '--local', '--config', 'wrangler.local.toml', '--command', sql], { cwd: __dirname + '/..', stdio: 'pipe', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
};

(async () => {
  if (process.env.SEMEAR === '1') { semear(); console.log('D1 local semeado com números SIMULADOS'); }
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  // sessão admin (reutilizada) e leitura das estatísticas via API
  const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  await loginCtx(adminCtx, 'admin@teste.local', 'Admin Local');
  const ADMIN_STATE = await adminCtx.storageState();
  const est = async () => (await adminCtx.request.get(API + '/admin/estatisticas', { headers: H })).json();

  // 1) anônimo, navegador de teste (navigator.webdriver = true)
  const antes = await est();
  {
    const ctx = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const me = [], analytics = [];
    page.on('request', r => { const u = r.url(); if (u.startsWith(API + '/me')) me.push(u.slice(API.length)); if (/cloudflareinsights\.com/.test(u)) analytics.push(u); });
    await page.goto(SITE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.CMV && document.getElementById('cmv-entrar'));
    await page.waitForTimeout(1500);
    ok('navigator.webdriver é true no navegador de teste', await page.evaluate(() => navigator.webdriver === true));
    ok('1ª abertura: /me?visita=1&wd=1 (uma vez só por página)', me[0] === '/me?visita=1&wd=1' && me.filter(u => /visita=|acesso=/.test(u)).length === 1, me);
    ok('marca do dia gravada no navegador (só a data BRT)', /^\d{4}-\d{2}-\d{2}$/.test(await page.evaluate(() => localStorage.getItem('cmv-visita-dia'))));
    me.length = 0;
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1500);
    ok('2ª abertura no mesmo dia: /me?acesso=1&wd=1', me[0] === '/me?acesso=1&wd=1', me);
    ok('Web Analytics não carrega em teste automático (nenhum pedido a cloudflareinsights)', analytics.length === 0 && !(await page.evaluate(() => !!document.querySelector('script[src*="cloudflareinsights"]'))), analytics);
    ok('menu: "Estatísticas do site" escondido para anônimo', await page.evaluate(() => { const e = document.getElementById('cmv-drawer-estat'); return !!e && e.hidden; }));
    await page.evaluate(() => { location.hash = '#estatisticas'; }); await page.waitForTimeout(800);
    ok('#estatisticas anônimo → pede para entrar, sem números', /conta administradora/.test(await page.textContent('#view-estatisticas')) && !(await page.$('#view-estatisticas .cmv-barras')));
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    ok('privacidade cita estatísticas anônimas sem IP', /Estatísticas anônimas de visitantes/.test(html) && /não guarda endereço IP, cookie nem qualquer identificador/.test(html));
    await ctx.close();
  }
  await new Promise(r => setTimeout(r, 500));
  const depois = await est();
  ok('aberturas do navegador de teste caem em "ignorados" e não mudam os totais de hoje', depois.ignorados_testes.hoje - antes.ignorados_testes.hoje === 2 && depois.periodos.hoje.visitantes === antes.periodos.hoje.visitantes && depois.periodos.hoje.acessos === antes.periodos.hoje.acessos, { antes: [antes.ignorados_testes.hoje, antes.periodos.hoje.acessos], depois: [depois.ignorados_testes.hoje, depois.periodos.hoje.acessos] });

  // 2) conta grátis: sem acesso
  {
    const ctx = await browser.newContext({ ...devices['iPhone 14'], serviceWorkers: 'block' });
    await loginCtx(ctx, `estat-gratis-${RUN}@teste.local`, 'Pessoa Grátis');
    const page = await ctx.newPage();
    await page.goto(SITE + '#conta', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#view-conta .cmv-conta .card h2'); await page.waitForTimeout(600);
    ok('grátis: sem cartão de estatísticas em Minha conta', !(await page.$('#view-conta .cmv-admin-card')));
    ok('grátis: item do menu escondido', await page.evaluate(() => document.getElementById('cmv-drawer-estat').hidden));
    await page.evaluate(() => { location.hash = '#estatisticas'; }); await page.waitForTimeout(800);
    ok('grátis: #estatisticas → "Acesso restrito"', /Acesso restrito/.test(await page.textContent('#view-estatisticas')) && !(await page.$('#view-estatisticas .cmv-barras')));
    const r = await ctx.request.get(API + '/admin/estatisticas', { headers: H });
    ok('grátis: API /admin/estatisticas → 403', r.status() === 403, r.status());
    await ctx.close();
  }

  // 3) conta administradora: página completa (computador e celular)
  const erros = [];
  for (const [nome, opts] of [['computador', { viewport: { width: 1280, height: 900 } }], ['celular', devices['iPhone 14 Pro Max']]]) {
    const ctx = await browser.newContext({ ...opts, serviceWorkers: 'block', storageState: ADMIN_STATE });
    const page = await ctx.newPage();
    page.on('pageerror', e => erros.push(e.message));
    await page.goto(SITE + '#conta', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#view-conta .cmv-admin-card', { timeout: 15000 }).catch(() => {});
    ok(`${nome}: admin vê o cartão "Estatísticas do site" em Minha conta`, !!(await page.$('#view-conta .cmv-admin-card')));
    ok(`${nome}: item do menu visível para o admin`, await page.evaluate(() => !document.getElementById('cmv-drawer-estat').hidden));
    await page.click('#view-conta .cmv-admin-card a[href="#estatisticas"]');
    await page.waitForSelector('#view-estatisticas .cmv-barras li:not(.cab)', { timeout: 15000 });
    const n = await page.$$eval('#view-estatisticas .card:first-of-type ~ .card .cmv-barras li:not(.cab)', l => l.length).catch(() => 0);
    const estados = await page.$$eval('#view-estatisticas .cmv-barras', ls => ls[0].querySelectorAll('li:not(.cab)').length);
    ok(`${nome}: lista com os 27 estados (+ "não identificado" quando houver)`, estados >= 27, estados);
    ok(`${nome}: título da aba`, /Estatísticas do site/.test(await page.title()));
    const kHoje = await page.textContent('.cmv-estat-kpis .card:first-child .x');
    await page.click('[data-per=d30]'); await page.waitForTimeout(200);
    const k30 = await page.textContent('.cmv-estat-kpis .card:first-child .x');
    ok(`${nome}: abas Hoje / 7 dias / 30 dias trocam os números`, Number(k30.replace(/\D/g, '')) >= Number(kHoje.replace(/\D/g, '')), { kHoje, k30 });
    await page.click('[data-per=d7]'); await page.waitForTimeout(200);
    ok(`${nome}: sem rolagem horizontal`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await page.screenshot({ path: `${OUT}/estatisticas-${nome}.png`, fullPage: nome === 'computador' });
    if (nome === 'celular') {
      await page.screenshot({ path: `${OUT}/estatisticas-celular-inteira.png`, fullPage: true });
      await page.evaluate(() => { location.hash = '#conta'; }); await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/minha-conta-admin-celular.png` });
      await page.evaluate(() => document.getElementById('nav-drawer') && (document.getElementById('nav-drawer').hidden = false));
      const dt = await page.$('[data-open-drawer], .menu-btn, #menu-btn, button[aria-controls="nav-drawer"]');
      if (dt) { await page.evaluate(() => { document.getElementById('nav-drawer').hidden = true; }); await dt.click(); await page.waitForTimeout(500); await page.evaluate(() => document.getElementById('cmv-drawer-estat').scrollIntoView({ block: 'center' })); await page.screenshot({ path: `${OUT}/menu-admin-celular.png` }); }
    }
    await ctx.close();
  }
  ok('sem erros de JavaScript na página de estatísticas', erros.length === 0, erros);
  await adminCtx.close(); await browser.close();
  fs.writeFileSync(OUT + '/resultado.json', JSON.stringify({ quando: new Date().toISOString(), falhas: fails, res }, null, 1));
  console.log(`\n${res.length - fails}/${res.length} verificações OK`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
