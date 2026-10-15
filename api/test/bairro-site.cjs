// E2E "Mais votados no seu bairro" (Playwright, celular): geolocalização simulada, escolha manual, aviso de 20 min com relógio falso,
// grátis × assinante (assinante via wrangler dev local + cortesia), privacidade (nenhuma coordenada na rede) e zero pedidos ao TSE.
// Pré-requisitos: wrangler dev (:8787) com R2 local semeado, dados públicos (:8766, serve_dados.py), site (:8080).
const { chromium, devices } = require('/workspace/eleicoes-se/assinaturas/api/test/sem-analytics.cjs')(require('/workspace/eleicoes-se/build/node_modules/playwright-core'));
const fs = require('fs');
const API = 'http://localhost:8787';
// BASE=https://cademeuvoto.com.br/ → produção, só leitura (sem a parte de assinante, que usa cortesia/admin do wrangler dev local)
const LIVE = !!process.env.BASE && !/localhost/.test(process.env.BASE);
const SITE = LIVE ? process.env.BASE : 'http://localhost:8080/?api=http://localhost:8787&dados=http://127.0.0.1:8766';
const OUT = process.env.OUT || (__dirname + '/out/bairro'); fs.mkdirSync(OUT, { recursive: true });
const consoleErros = [];
const ADMIN_TOKEN = (fs.readFileSync(__dirname + '/../.dev.vars', 'utf8').match(/^ADMIN_TOKEN=(.*)$/m) || [])[1];
const RUN = Date.now().toString(36);
let fails = 0, total = 0;
const ok = (n, c, info) => { total++; if (!c) fails++; console.log((c ? '✔ ' : '✘ ') + n + (c ? '' : ' → ' + String(JSON.stringify(info)).slice(0, 500))); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const LUGARES = {
  farolandia: { latitude: -10.96921, longitude: -37.05912, uf: 'se', cd: '31054', bairro: /Farol[aâ]ndia/i },
  tabuleiro: { latitude: -9.57702, longitude: -35.77325, uf: 'al', cd: '27855', bairro: /Tabuleiro do Martins/i },
  vilamariana: { latitude: -23.58902, longitude: -46.63421, uf: 'sp', cd: '71072', bairro: /Vila Mariana/i },
  centro_aju: { latitude: -10.91111, longitude: -37.05220 },
};
// pedaços das coordenadas simuladas que jamais podem aparecer em pedido de rede
const COORD_PEDACOS = Object.values(LUGARES).flatMap(l => [String(Math.abs(l.latitude)).slice(0, 6), String(Math.abs(l.longitude)).slice(0, 6)]);
const rede = { coords: [], tse: [], externos: [], total: 0 };
const PIXEL = devices['Pixel 7'], IPHONE = devices['iPhone 14 Pro Max'];

const CONTA_GEO = () => {
  const g = navigator.geolocation; if (!g) return;
  const c = g.getCurrentPosition.bind(g), w = g.watchPosition.bind(g);
  window.__geo = { get: 0, watch: 0 };
  g.getCurrentPosition = function (...a) { window.__geo.get++; return c(...a); };
  g.watchPosition = function (...a) { window.__geo.watch++; return w(...a); };
};
const NEGA_GEO = () => {
  const g = navigator.geolocation;
  window.__geo = { get: 0, watch: 0 };
  g.getCurrentPosition = (s, e) => { window.__geo.get++; setTimeout(() => e({ code: 1, message: 'User denied Geolocation' }), 20); };
  g.watchPosition = (s, e) => { window.__geo.watch++; setTimeout(() => e({ code: 1, message: 'User denied Geolocation' }), 20); return 1; };
};

async function abrir(browser, dev, { geo, permitir = true, init = [], insets, clock } = {}) {
  const ctx = await browser.newContext({ ...dev, serviceWorkers: 'block', ...(geo ? { geolocation: { latitude: geo.latitude, longitude: geo.longitude, accuracy: 30 } } : {}), permissions: permitir ? ['geolocation'] : [] });
  for (const s of init) await ctx.addInitScript(s);
  const page = await ctx.newPage();
  const erros = []; page.on('pageerror', e => erros.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErros.push(m.text() + ' @ ' + ((m.location() || {}).url || '')); });
  page.on('requestfailed', r => { if (!/abacus/.test(r.url())) consoleErros.push('falhou: ' + r.url() + ' ' + ((r.failure() || {}).errorText || '')); });
  page.on('request', r => {
    rede.total++;
    const u = r.url(), h = new URL(u).hostname, body = r.postData() || '';
    if (COORD_PEDACOS.some(p => u.includes(p) || body.includes(p))) rede.coords.push(u);
    if (/(^|\.)tse\.jus\.br$/.test(h)) rede.tse.push(u);
    if (!['localhost', '127.0.0.1', 'cademeuvoto.com.br', 'dados.cademeuvoto.com.br', 'api.cademeuvoto.com.br'].includes(h) || (!LIVE && /cademeuvoto/.test(h))) rede.externos.push(u);
  });
  if (insets) { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, topMax: 0, bottom: 0, bottomMax: 0, left: 0, leftMax: 0, right: 0, rightMax: 0, ...insets } }); }
  if (clock) await page.clock.install({ time: new Date('2026-10-07T10:00:00-03:00') });
  await page.goto(SITE, { waitUntil: 'load' });
  await page.waitForSelector('#cmv-entrar', { timeout: 20000 });
  return { ctx, page, erros };
}
const semOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
async function irBairro(page) { await page.evaluate(() => { location.hash = '#bairro'; }); await page.waitForSelector('#bx-consent', { timeout: 10000 }); }
async function esperaResultado(page) { await page.waitForSelector('#bx-ver .bx-lista li, #bx-ver .bx-aviso', { timeout: 30000 }); await page.waitForSelector('#bx-c5', { timeout: 30000 }); }
async function contaLis(page, sel) { return page.locator(sel + ' > .bx-lista').first().locator('li').count(); }

async function cadastrar(page, nome, email) {
  await page.click('#cmv-entrar');
  await page.click('.cmv-tabs button[data-tab=cadastro]');
  const f = page.locator('form[data-form=cadastro]');
  await f.locator('input[name=nome]').fill(nome); await f.locator('input[name=email]').fill(email);
  await f.locator('input[name=cidade]').fill('Aracaju'); await f.locator('select[name=uf]').selectOption('se');
  await f.locator('select[name=perfil]').selectOption('campanha'); await f.locator('input[name=aceite_termos]').check();
  await f.locator('button[type=submit]').click();
  await page.waitForSelector('form[data-form=codigo]:not([hidden])', { timeout: 10000 });
  let cod = null;
  for (let i = 0; i < 20 && !cod; i++) { const j = await (await fetch(`${API}/__dev/outbox?to=${encodeURIComponent(email)}`)).json(); const m = j.emails.length && j.emails[j.emails.length - 1].text.match(/\b(\d{6})\b/); cod = m && m[1]; if (!cod) await sleep(300); }
  await page.fill('form[data-form=codigo] input[name=codigo]', cod);
  await page.waitForSelector('#cmv-modal', { state: 'detached', timeout: 10000 });
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const livre = JSON.parse(fs.readFileSync('/workspace/m2024/out/proposta/m2024/se/top3-livre/31054.json', 'utf8'));
  const livre26 = JSON.parse(fs.readFileSync('/workspace/m2024/out/proposta/e2026/se/top3-livre/31054.json', 'utf8'));

  // 1) Pixel: cartão na home, consentimento, localização → Farolândia (grátis)
  {
    const { ctx, page, erros } = await abrir(browser, PIXEL, { geo: LUGARES.farolandia, init: [CONTA_GEO] });
    const card = page.locator('#bx-home-card');
    await card.scrollIntoViewIfNeeded();
    ok('home: cartão "Mais votados no seu bairro" visível', await card.isVisible());
    await page.waitForTimeout(600);
    await card.screenshot({ path: OUT + '/1-cartao-home.png' });
    await page.screenshot({ path: OUT + '/1b-home-celular.png' });
    ok('home: nenhuma chamada de geolocalização ao abrir a página', (await page.evaluate(() => window.__geo)).get === 0 && (await page.evaluate(() => window.__geo)).watch === 0);
    await page.click('.nav-burger, [data-open-drawer], #nav-toggle').catch(() => {});
    const temMenu = await page.locator('#nav-drawer a[data-view=bairro]').count();
    ok('menu: item "Mais votados no seu bairro"', temMenu === 1);
    await page.keyboard.press('Escape').catch(() => {});
    await page.evaluate(() => { const d = document.getElementById('nav-drawer'); if (d) d.hidden = true; });
    await card.click();
    await page.waitForSelector('#bx-consent');
    ok('tela do recurso: explicação + 2 opções, sem pedir localização ainda', (await page.locator('#bx-consent [data-bx=geo]').isVisible()) && (await page.locator('#bx-consent [data-bx=picker]').isVisible()) && (await page.evaluate(() => window.__geo.get)) === 0);
    ok('consentimento: diz para quê, o que é usado e que nada é guardado', /Para quê/.test(await page.textContent('#bx-consent')) && /não é enviada ao nosso servidor nem fica guardada/.test(await page.textContent('#bx-consent')));
    await page.screenshot({ path: OUT + '/2-consentimento.png' });
    await page.click('#bx-consent [data-bx=geo]');
    await esperaResultado(page);
    const h1 = await page.textContent('#view-bairro h1');
    ok('Farolândia: bairro detectado pelo local de votação mais próximo', LUGARES.farolandia.bairro.test(h1) && /local de votação mais próximo/.test(await page.textContent('.bx-loc')), h1);
    ok('Farolândia: link "Trocar bairro"', await page.locator('[data-bx=trocar]').isVisible());
    const nV = await contaLis(page, '#bx-ver'), nP = await contaLis(page, '#bx-pre');
    ok('grátis: top 3 Vereador e Prefeito', nV === 3 && nP === 3, [nV, nP]);
    ok('grátis: eleitos mais votados aqui (Vereador, 3)', (await page.locator('#bx-ver .bx-lista').nth(1).locator('li').count()) === 3);
    for (const c of ['7', '6', '5']) ok(`grátis: 2026 cargo ${c} com top 3`, (await contaLis(page, '#bx-c' + c)) === 3);
    ok('grátis: "Mostrar votos" em cada linha', (await page.locator('#view-bairro .bx-lista li').count()) === (await page.locator('#view-bairro [data-bx-votos]:visible').count()));
    ok('grátis: sem votos nem % na tela', (await page.locator('.bx-votos').count()) === 0 && !/\d+,\d%/.test(await page.textContent('#view-bairro')));
    ok('grátis: badges eleito/não eleito', (await page.locator('#bx-ver .bx-badge').count()) >= 3);
    await page.locator('#bx-c6').scrollIntoViewIfNeeded(); await page.waitForTimeout(1500);   // fotos lazy (Presidente/Senador vêm antes)
    const fotosOk = await page.evaluate(() => [...document.querySelectorAll('#view-bairro .bx-foto img')].filter(i => i.complete && i.naturalWidth > 0).length);
    ok('grátis: fotos carregadas (2024 e 2026)', fotosOk >= 6 && (await page.evaluate(() => [...document.querySelectorAll('#bx-c6 .bx-foto img')].some(i => i.naturalWidth > 0))), fotosOk);
    const fb = livre.top[livre.bairros.findIndex(b => b === 'FAROLANDIA')];
    const nome1 = livre.c['13'][fb.v[0]][0];
    ok('grátis: 1º Vereador igual ao arquivo grátis', (await page.locator('#bx-ver .bx-lista li .bx-nome strong').first().textContent()).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') === nome1.normalize('NFD').replace(/[\u0300-\u036f]/g, ''), nome1);
    const fb26 = livre26.top[livre26.bairros.findIndex(b => b === 'FAROLANDIA')];
    ok('grátis: 1º Dep. Federal igual ao arquivo grátis 2026', (await page.locator('#bx-c6 .bx-lista li .bx-nome strong').first().textContent()).toUpperCase() === livre26.c[fb26['6'][0]][1].toUpperCase());
    ok('grátis: CTA "Ver votos e ranking completo — Assinatura"', /Ver votos e ranking completo — Assinatura/.test(await page.textContent('[data-bx-cta]')));
    ok('"Mandar recado" desabilitado (em breve)', await page.locator('button:has-text("Mandar recado")').isDisabled());
    ok('linha de fonte TSE 2024/2026', /TSE — Eleições Municipais 2024.*Eleições Gerais 2026/.test(await page.textContent('.bx-fonte')));
    ok('Pixel: sem rolagem horizontal', await semOverflow(page));
    await page.screenshot({ path: OUT + '/3-resultado-gratis-farolandia.png', fullPage: true });
    ok('Pixel: sem erros de JS', erros.length === 0, erros);
    await ctx.close();
  }

  // 2) iPhone com notch: Maceió/Tabuleiro do Martins
  {
    const { ctx, page, erros } = await abrir(browser, IPHONE, { geo: LUGARES.tabuleiro, insets: { top: 59, topMax: 59, bottom: 34, bottomMax: 34 } });
    await irBairro(page); await page.click('#bx-consent [data-bx=geo]'); await esperaResultado(page);
    ok('Maceió: Tabuleiro do Martins', LUGARES.tabuleiro.bairro.test(await page.textContent('#view-bairro h1')), await page.textContent('#view-bairro h1'));
    ok('Maceió: top 3 Vereador/Prefeito', (await contaLis(page, '#bx-ver')) === 3 && (await contaLis(page, '#bx-pre')) === 3);
    ok('iPhone: sem rolagem horizontal', await semOverflow(page));
    await page.screenshot({ path: OUT + '/4-resultado-gratis-tabuleiro-iphone.png' });
    ok('iPhone: sem erros de JS', erros.length === 0, erros);
    await ctx.close();
  }

  // 3) São Paulo/Vila Mariana
  {
    const { ctx, page, erros } = await abrir(browser, PIXEL, { geo: LUGARES.vilamariana });
    await irBairro(page); await page.click('#bx-consent [data-bx=geo]'); await esperaResultado(page);
    ok('São Paulo: Vila Mariana', LUGARES.vilamariana.bairro.test(await page.textContent('#view-bairro h1')), await page.textContent('#view-bairro h1'));
    ok('São Paulo: 2026 com Dep. Estadual/Federal/Senador', (await contaLis(page, '#bx-c7')) === 3 && (await contaLis(page, '#bx-c6')) === 3 && (await contaLis(page, '#bx-c5')) === 3);
    ok('São Paulo: sem erros de JS', erros.length === 0, erros);
    await ctx.close();
  }

  // 4) permissão negada → escolha manual; escolha manual completa
  {
    const { ctx, page, erros } = await abrir(browser, PIXEL, { permitir: false, init: [NEGA_GEO] });
    await irBairro(page); await page.click('#bx-consent [data-bx=geo]');
    await page.waitForSelector('#bx-picker', { timeout: 10000 });
    ok('negada: cai na escolha manual com aviso', /Sem permissão/.test(await page.textContent('#bx-picker')));
    await page.selectOption('#bx-picker [data-p=uf]', 'se');
    await page.waitForFunction(() => { const s = document.querySelector('#bx-picker [data-p=cd]'); return s && !s.disabled && s.options.length > 10; });
    await page.selectOption('#bx-picker [data-p=cd]', '31054');
    await page.waitForFunction(() => { const s = document.querySelector('#bx-picker [data-p=b]'); return s && !s.disabled && s.options.length > 10; });
    const nb = await page.locator('#bx-picker [data-p=b] option').count();
    ok('manual: lista de bairros de Aracaju (2024 ∪ 2026)', nb > 40, nb);
    await page.selectOption('#bx-picker [data-p=b]', { label: 'Farolandia' });
    await page.screenshot({ path: OUT + '/5-escolha-manual.png' });
    await page.click('#bx-picker [data-bx=ver]'); await esperaResultado(page);
    ok('manual: resultado de Farolândia, "Bairro escolhido por você"', LUGARES.farolandia.bairro.test(await page.textContent('#view-bairro h1')) && /escolhido por você/.test(await page.textContent('.bx-loc')));
    // município com aviso de eleição suplementar (CE/Potiretama): sem eleito para Prefeito
    await page.click('[data-bx=trocar]'); await page.waitForSelector('#bx-picker');
    await page.selectOption('#bx-picker [data-p=uf]', 'ce');
    await page.waitForFunction(() => { const s = document.querySelector('#bx-picker [data-p=cd]'); return s && !s.disabled && [...s.options].some(o => o.value === '13269'); });
    await page.selectOption('#bx-picker [data-p=cd]', '13269');
    await page.waitForFunction(() => { const s = document.querySelector('#bx-picker [data-p=b]'); return s && !s.disabled && s.options.length > 1; });
    await page.selectOption('#bx-picker [data-p=b]', { index: 1 });
    await page.click('#bx-picker [data-bx=ver]'); await esperaResultado(page);
    ok('suplementar: aviso e nenhum badge de eleito em Prefeito', /eleição suplementar/i.test(await page.textContent('#bx-pre')) && (await page.locator('#bx-pre .bx-badge').count()) === 0);
    // sem situação final no TSE (SE/31313): eleito conforme relatório oficial
    await page.click('[data-bx=trocar]'); await page.waitForSelector('#bx-picker');
    await page.selectOption('#bx-picker [data-p=uf]', 'se');
    await page.waitForFunction(() => { const s = document.querySelector('#bx-picker [data-p=cd]'); return s && !s.disabled && [...s.options].some(o => o.value === '31313'); });
    await page.selectOption('#bx-picker [data-p=cd]', '31313');
    await page.waitForFunction(() => { const s = document.querySelector('#bx-picker [data-p=b]'); return s && !s.disabled && s.options.length > 1; });
    await page.selectOption('#bx-picker [data-p=b]', { index: 1 });
    await page.click('#bx-picker [data-bx=ver]'); await esperaResultado(page);
    ok('sem resultado final: "conforme relatório oficial de totalização de 2024"', /conforme relatório oficial de totalização de 2024/.test(await page.textContent('#bx-pre')));
    // Minha conta (sem login): interruptor do aviso
    await page.evaluate(() => { location.hash = '#conta'; }); await page.waitForSelector('#bx-conta-card', { timeout: 10000 });
    ok('Minha conta: cartão Localização com interruptor do aviso', await page.locator('#bx-conta-card input[data-bx-aviso]').count() === 1);
    await page.click('#bx-conta-card .bx-switch'); await page.waitForTimeout(300);
    ok('Minha conta: permissão negada ao ligar → aviso volta a desligado', (await page.evaluate(() => localStorage.getItem('cmv_bairro_aviso'))) === null && !(await page.isChecked('#bx-conta-card input[data-bx-aviso]')));
    ok('Privacidade: seção de localização', /não é enviada ao nosso servidor/.test(await page.evaluate(() => document.getElementById('priv-localizacao').textContent)));
    ok('negada/manual: sem erros de JS', erros.length === 0, erros);
    await ctx.close();
  }

  // 5) aviso ligado mas sem permissão dada: abrir a página NÃO chama a geolocalização
  {
    const { ctx, page } = await abrir(browser, PIXEL, { permitir: false, init: [CONTA_GEO, () => localStorage.setItem('cmv_bairro_aviso', '1')] });
    await page.waitForTimeout(1500);
    const g = await page.evaluate(() => window.__geo);
    ok('abertura com aviso ligado e permissão não concedida: 0 chamadas de geolocalização', g.get === 0 && g.watch === 0, g);
    await ctx.close();
  }

  // 6) aviso de 20 min com relógio falso (iPhone com notch)
  {
    const { ctx, page, erros } = await abrir(browser, IPHONE, { geo: LUGARES.farolandia, insets: { top: 59, topMax: 59, bottom: 34, bottomMax: 34 }, clock: true });
    await irBairro(page);
    await page.click('#bx-aviso-tela + .bx-sw');
    const dw = () => page.evaluate(() => { const d = window.Bairro._teste.dw; return { key: d.anchor && d.anchor.key, acc: d.acc, watch: d.watchId != null }; });
    let s = null;
    for (let i = 0; i < 60; i++) { s = await dw(); if (s.key) break; await page.clock.runFor(500); await sleep(150); }
    ok('aviso: ligado pelo toque, observando a posição', s && s.watch && /^se:31054:FAROLANDIA$/.test(s.key), s);
    ok('aviso: escolha guardada (só "1", sem coordenadas)', (await page.evaluate(() => localStorage.getItem('cmv_bairro_aviso'))) === '1' && !(await page.evaluate(() => JSON.stringify(localStorage))).match(/-?\d{1,2}\.\d{4,}/));
    await page.clock.runFor(10 * 60 * 1000);
    ok('aviso: 10 min visíveis → ainda sem aviso', (await page.locator('#bx-toast').count()) === 0);
    // some da tela: pausa
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    const a1 = (await dw()).acc;
    await page.clock.runFor(30 * 60 * 1000);
    const s2 = await dw();
    ok('aviso: escondida → para de observar e o tempo não anda', !s2.watch && s2.acc === a1 && (await page.locator('#bx-toast').count()) === 0, [a1, s2]);
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.clock.runFor(8 * 60 * 1000);
    ok('aviso: de volta → observa de novo; 18 min no total ainda sem aviso', (await dw()).watch && (await page.locator('#bx-toast').count()) === 0, await dw());
    await page.clock.runFor(2.5 * 60 * 1000);
    await page.waitForSelector('#bx-toast', { timeout: 5000 }).catch(() => {});
    ok('aviso: 20 min visíveis no mesmo bairro → "Você está em Farolândia…"', /Você está em Farol[aâ]ndia\..*Veja quem foram os mais votados aqui/.test((await page.textContent('#bx-toast').catch(() => '')) || ''));
    const box = await page.locator('#bx-toast').boundingBox();
    const vp = page.viewportSize();
    ok('aviso: respeita a barra de gestos (área segura)', box && box.y + box.height <= vp.height - 34, [box, vp]);
    await page.screenshot({ path: OUT + '/6-aviso-20min.png' });
    const vistos = JSON.parse(await page.evaluate(() => localStorage.getItem('cmv_bairro_vistos')) || '{}');
    ok('aviso: registrado como visto hoje (por bairro)', vistos['se:31054:FAROLANDIA'] === '2026-10-07', vistos);
    await page.click('#bx-toast [data-t=fechar]');
    await page.clock.runFor(25 * 60 * 1000);
    ok('aviso: no máximo 1 vez por bairro por dia', (await page.locator('#bx-toast').count()) === 0);
    // muda de bairro → zera
    await ctx.setGeolocation({ latitude: LUGARES.centro_aju.latitude, longitude: LUGARES.centro_aju.longitude, accuracy: 30 });
    let s3 = null;
    for (let i = 0; i < 60; i++) { await page.clock.runFor(1000); await sleep(150); s3 = await dw(); if (s3.key && s3.key !== 'se:31054:FAROLANDIA') break; }
    ok('aviso: mudou de bairro → contador zera', s3 && s3.key !== 'se:31054:FAROLANDIA' && s3.acc < 5 * 60 * 1000, s3);
    await page.clock.runFor(10 * 60 * 1000);
    ok('aviso: 10 min no bairro novo → sem aviso', (await page.locator('#bx-toast').count()) === 0);
    await page.click('#bx-toast [data-t=ver]').catch(() => {});
    ok('aviso: sem erros de JS', erros.length === 0, erros);
    // desligar pela tela do recurso
    await page.click('#bx-aviso-tela + .bx-sw');
    ok('aviso: desligado pela tela → para de observar', !(await dw()).watch && (await page.evaluate(() => localStorage.getItem('cmv_bairro_aviso'))) === null);
    await ctx.close();
  }

  if (!LIVE) // 7) assinante (cortesia local): votos, %, ranking completo, eleitos, 2º turno, comparativo e detalhe por local
  {
    const { ctx, page, erros } = await abrir(browser, PIXEL, { geo: LUGARES.farolandia });
    const dados = []; page.on('response', r => { if (r.url().startsWith(API + '/dados/')) dados.push([r.url().slice(API.length), r.status()]); });
    // IP falso só no wrangler dev local (o limite de cadastros por rede é por IP; as outras suítes usam o mesmo 127.0.0.1)
    const ipFalso = `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    await page.route(API + '/**', r => r.continue({ headers: { ...r.request().headers(), 'cf-connecting-ip': ipFalso } }));
    const email = `bairro-${RUN}@teste.local`;
    await cadastrar(page, 'Ana Bairro', email);
    const me = await (await fetch(`${API}/admin/usuarios?q=${encodeURIComponent(email)}`, { headers: { Authorization: 'Bearer ' + ADMIN_TOKEN, Origin: 'http://localhost:8080' } })).json();
    const id = me.usuarios && me.usuarios[0] && me.usuarios[0].id;
    const g = await fetch(`${API}/admin/usuarios/${id}/cortesia`, { method: 'POST', headers: { Authorization: 'Bearer ' + ADMIN_TOKEN, 'Content-Type': 'application/json', Origin: 'http://localhost:8080' }, body: JSON.stringify({ dias: 30, motivo: 'e2e bairro' }) });
    ok('assinante: cortesia concedida (admin local)', g.status === 200, g.status);
    await page.evaluate(() => window.CMV.refresh());
    await page.waitForFunction(() => window.CMV.pro(), null, { timeout: 10000 });
    await irBairro(page); await page.click('#bx-consent [data-bx=geo]'); await esperaResultado(page);
    await page.waitForSelector('.bx-votos', { timeout: 15000 });
    ok('assinante: votos e % na tela', (await page.locator('#bx-ver .bx-votos').count()) >= 3 && /\d+,\d%/.test(await page.textContent('#bx-ver')));
    ok('assinante: todos os eleitos com voto aqui', /Todos os eleitos com voto aqui \(\d+\)/.test(await page.textContent('#bx-ver')));
    ok('assinante: ranking completo', /Ranking completo \(\d+ candidatos\)/.test(await page.textContent('#bx-ver')));
    ok('assinante: 2º turno de Prefeito (Aracaju)', /2º turno/.test(await page.textContent('#bx-pre')));
    ok('assinante: 2026 com votos e eleitos', (await page.locator('#bx-c6 .bx-votos').count()) >= 3 && /Eleitos com voto aqui/.test(await page.textContent('#bx-c6')));
    ok('assinante: comparativo 2024 × 2026', /Eleitores aptos/.test(await page.textContent('#bx-cmp')));
    ok('assinante: sem CTA de assinatura', (await page.locator('[data-bx-cta]').count()) === 0);
    ok('assinante: sem botões "Mostrar votos"', (await page.locator('[data-bx-votos]').count()) === 0);
    await page.screenshot({ path: OUT + '/7-resultado-assinante.png', fullPage: true });
    await page.click('[data-bx=drill]');
    await page.waitForSelector('.bx-local', { timeout: 20000 });
    ok('assinante: detalhe por local de votação (2024)', (await page.locator('.bx-local').count()) >= 3);
    const pedidos = dados.map(d => d.join(' '));
    ok('assinante: arquivos privados via API /dados (200)', ['/dados/m2024/se/top3/31054.json 200', '/dados/e2026/se/top3/31054.json 200', '/dados/m2024/se/det/31054/agg.json 200'].every(x => pedidos.includes(x)), pedidos);
    ok('assinante: sem erros de JS', erros.length === 0, erros);
    await ctx.close();
  }

  ok('privacidade: nenhuma coordenada em pedido de rede', rede.coords.length === 0, rede.coords.slice(0, 5));
  ok('zero pedidos ao TSE', rede.tse.length === 0, rede.tse.slice(0, 5));
  ok('nenhum pedido fora de localhost (dados/API locais)', rede.externos.filter(u => !/^https:\/\/(challenges\.cloudflare\.com|fonts\.|abacus\.jasoncameron\.dev)/.test(u)).length === 0, [...new Set(rede.externos.map(u => new URL(u).origin))]);
  if (LIVE) {
    // anônimo em produção: votos por bairro protegidos
    const r = await fetch('https://api.cademeuvoto.com.br/dados/m2024/se/top3/31054.json', { headers: { Origin: 'https://cademeuvoto.com.br' } });
    ok('produção: /dados/m2024 top3 sem sessão → 401', r.status === 401, r.status);
  }
  const cErr = consoleErros.filter(t => !/abacus/.test(t));
  console.log('erros de console/rede:', cErr.length, JSON.stringify(cErr.slice(0, 8)));
  ok('sem erros de console', cErr.length === 0, cErr.slice(0, 5));
  await browser.close();
  console.log(`\n${total - fails}/${total} ok · pedidos de rede observados: ${rede.total}`);
  fs.writeFileSync(OUT + '/resultado.json', JSON.stringify({ base: SITE, total, fails, consoleErros, rede: { total: rede.total, coords: rede.coords, tse: rede.tse, externos: [...new Set(rede.externos)] } }, null, 1));
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
