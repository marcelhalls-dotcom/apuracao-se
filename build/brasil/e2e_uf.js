// E2E por cliques na UI: node e2e_uf.js <base> <uf> [outros ufs p/ isolamento...]
const path = require('path');
// playwright-core: PW_CORE=<caminho> ou instalado no projeto (npm i playwright-core); Chrome em CHROME_PATH
let pw; try { pw = require(process.env.PW_CORE || 'playwright-core'); } catch (_) { pw = require('/workspace/eleicoes-se/build/node_modules/playwright-core'); }
const { chromium } = pw;
const fs = require('fs');
const BASE = process.argv[2], UF = process.argv[3], OTHERS = process.argv.slice(4);
const SITE = process.env.CMV_SITE || path.resolve(__dirname, '..', '..'), OUT = process.env.CMV_OUT || path.resolve(SITE, '..', 'rebrand', 'brasil');
fs.mkdirSync(OUT, { recursive: true });
const ctxOf = u => u === 'se' ? null : JSON.parse(fs.readFileSync(`${SITE}/mapa/${u}/context.json`, 'utf8'));
const fmt = n => n.toLocaleString('pt-BR');
const fold = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const res = { uf: UF, base: BASE, checks: [], fails: [] };
const ok = (name, cond, info) => { (cond ? res.checks : res.fails).push(name + (info ? ' — ' + info : '')); console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (info ? ' — ' + info : '')); };
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  let tse = [], errs = [];
  page.on('request', r => { if (/tse\.jus\.br/.test(r.url())) tse.push(r.url()); });
  page.on('pageerror', e => errs.push(e.message));
  const shot = async (file) => {
    const c = await ctx.newCDPSession(page);
    const { data } = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(file, Buffer.from(data, 'base64')); await c.detach();
  };
  const settle = async (ms = 1200) => { await page.waitForTimeout(ms); await page.waitForFunction(() => !document.getElementById('status-curto') || !/Atualizando|Conectando/.test(document.getElementById('status-curto').textContent), null, { timeout: 30000 }).catch(() => {}); };
  const viewText = v => page.evaluate(v => (document.getElementById('view-' + v) || document.body).innerText, v);
  const hashUf = () => page.evaluate(() => new URLSearchParams(location.hash.split('?')[1] || '').get('uf'));
  const statusOk = () => page.evaluate(() => { const b = document.getElementById('status'); return { cls: b.className, txt: (document.getElementById('status-curto') || {}).textContent }; });
  const clickTab = async v => { await page.click(`#nav-tabs a[data-view="${v}"]`); await settle(); };
  const pickUf = async u => { await clickTab('inicio'); await page.click(`#uf-picker a[data-uf="${u}"]`); await settle(2500); };

  const C = ctxOf(UF);
  await page.goto(BASE + '#inicio', { waitUntil: 'domcontentloaded' }); await settle(3000);
  const meta = await page.evaluate(u => ({ ...UF_REGISTRY[u] }), UF);
  const D = await page.evaluate(() => UF_DESTAQUES);
  ok('chip ' + UF + ' disponível no seletor', await page.$(`#uf-picker a.is-ready[data-uf="${UF}"]`) != null);
  await pickUf(UF);
  ok('hash leva uf=' + UF, (await hashUf()) === UF);
  const st = await statusOk();
  ok('cabeçalho sem alerta', !/erro|pendente/.test(st.cls) && /Resultado final/.test(st.txt), st.cls + ' / ' + st.txt);
  const sec = await page.textContent('#sec-resultados-title');
  ok('gramática home', sec.trim() === `Resultados ${meta.em || 'em'} ${meta.nome}`, sec);
  ok('painel da UF', (await page.textContent('#hero-panel-title')).includes(meta.nome));
  await page.waitForTimeout(1500);
  await shot(`${OUT}/${UF}-home.png`);

  // nomes proibidos = destaques de governo das outras UFs
  const forb = Object.entries(D).filter(([u]) => u !== UF).flatMap(([, d]) => d.gov.map(x => x.nome));
  forb.push('Sergipe', 'Alese', 'Aracaju');
  const badPrep = new RegExp(`(^|[^\\wÀ-ú])(de|em|De|Em) ${meta.nome}(?![\\wÀ-ú])`);
  const views = ['inicio', 'governo', 'senado', 'presidente', 'federais', 'estaduais', 'suplentes'];
  for (const v of views) {
    await clickTab(v);
    let t = await viewText(v); if (v === 'inicio') t = t.replace(/Começamos por Sergipe[^\n]*/, '').replace(/ESCOLHA O ESTADO[\s\S]*?estados\s*EM BREVE/i, ''); const ft = fold(t);
    const hit = forb.filter(n => ft.includes(fold(n)));
    ok(`[${v}] uf no hash`, (await hashUf()) === UF);
    ok(`[${v}] sem dados de outra UF`, hit.length === 0, hit.join(', '));
    if (meta.prep && meta.prep !== 'de') ok(`[${v}] preposição`, !badPrep.test(t), (t.match(badPrep) || [])[0]);
    if (v === 'governo') {
      const g = C.cargos.governador.candidatos;
      ok('[governo] votos 1º colocado = TSE', t.includes(fmt(g[0].votos)), g[0].nome + ' ' + fmt(g[0].votos));
      ok('[governo] votos 2º colocado = TSE', t.includes(fmt(g[1].votos)), g[1].nome + ' ' + fmt(g[1].votos));
      if (g[0].sit === '2º turno') ok('[governo] selo 2º TURNO', /2º TURNO/.test(t));
      else ok('[governo] sem selo 2º turno indevido', !/2º TURNO/.test(t));
      await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(800);
      await shot(`${OUT}/${UF}-governo.png`);
    }
    if (v === 'senado') { const s = C.cargos.senado.candidatos.filter(x => x.eleito); ok('[senado] eleitos = TSE', s.every(x => t.includes(fmt(x.votos))), s.map(x => x.nome + ' ' + fmt(x.votos)).join(', ')); }
    if (v === 'federais' || v === 'estaduais') {
      const n = await page.evaluate(v => { const c = [...document.querySelectorAll('#view-' + v + ' section.card.alese')].find(x => v === 'federais' ? x.classList.contains('hemi-fed') : !x.classList.contains('hemi-fed')); return c ? c.querySelectorAll('svg circle.cad').length : -1; }, v);
      const exp = v === 'federais' ? C.cadeiras.camara : C.cadeiras.assembleia;
      ok(`[${v}] hemiciclo ${exp} cadeiras (agr.vag TSE)`, n === exp, 'desenhadas ' + n);
      ok(`[${v}] sem aviso de soma`, !t.includes('soma das vagas'));
    }
  }
  // mapa via CTA da home
  await clickTab('inicio'); await page.click('#cta-mapa'); await settle(6000);
  ok('[mapa] uf no hash', (await hashUf()) === UF);
  const mp = await page.evaluate(() => { const s = [...document.querySelectorAll('#view-mapa svg')].find(x => x.querySelectorAll('path').length > 20); if (!s) return null;
    const gb = [...s.querySelectorAll('.choro-lab')].map(g => { const b = [...g.querySelectorAll('text')].map(t => t.getBBox()); return { x1: Math.min(...b.map(q => q.x)), y1: Math.min(...b.map(q => q.y)), x2: Math.max(...b.map(q => q.x + q.width)), y2: Math.max(...b.map(q => q.y + q.height)) }; });
    let ov = 0; for (let i = 0; i < gb.length; i++) for (let j = i + 1; j < gb.length; j++) { const A = gb[i], B = gb[j]; if (A.x1 < B.x2 && B.x1 < A.x2 && A.y1 < B.y2 && B.y1 < A.y2) ov++; }
    return { paths: s.querySelectorAll('path').length, labels: gb.length, ov, text: document.getElementById('view-mapa').innerText.slice(0, 4000) }; });
  ok('[mapa] coroplético carregado', mp && mp.paths > 20, mp && (mp.paths + ' municípios, ' + mp.labels + ' rótulos'));
  ok('[mapa] rótulos sem sobreposição', mp && mp.ov === 0, mp && ('sobreposições ' + mp.ov));
  for (const v of ['comparar', 'relatorios']) {
    const a = await page.$(`a[href^="#${v}"]:visible`);
    if (a) { await a.click(); } else { await page.evaluate(v => { location.hash = '#' + v; }, v); }
    await settle(2500);
    const t = await viewText(v);
    ok(`[${v}] uf no hash`, (await hashUf()) === UF);
    ok(`[${v}] nome da UF`, t.includes(meta.nome));
    if (meta.prep && meta.prep !== 'de') ok(`[${v}] preposição`, !badPrep.test(t), (t.match(badPrep) || [])[0]);
  }
  // isolamento: troca para as outras UFs e volta
  for (const o of OTHERS) {
    await pickUf(o); await clickTab('governo');
    const t = fold(await viewText('governo')); const myWin = fold(D[UF].gov[0].nome);
    const theirs = o === 'se' ? null : fold(D[o].gov[0].nome);
    ok(`[isolamento ${o}] governo mostra ${o.toUpperCase()} e não ${UF.toUpperCase()}`, (theirs ? t.includes(theirs) : true) && !t.includes(myWin) && (await hashUf()) === o);
    const s2 = await statusOk(); ok(`[isolamento ${o}] sem alerta`, !/erro|pendente/.test(s2.cls), s2.txt);
  }
  await pickUf(UF); await clickTab('governo');
  ok('[volta] governo ' + UF, fold(await viewText('governo')).includes(fold(D[UF].gov[0].nome)));
  ok('zero pedidos ao TSE no navegador', tse.length === 0, tse.length + ' pedidos ' + tse.slice(0, 3).join(' '));
  ok('sem erros JS', errs.length === 0, errs.slice(0, 3).join(' | '));
  fs.writeFileSync(`${OUT}/${UF}-e2e.json`, JSON.stringify(res, null, 1));
  console.log(`RESUMO ${UF}: ${res.checks.length} ok, ${res.fails.length} falhas`);
  await browser.close();
})().catch(e => { console.error('ERRO', e); process.exit(1); });
