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
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  let tse = [], errs = [];
  page.on('request', r => { if (/tse\.jus\.br/.test(r.url())) tse.push(r.url()); });
  page.on('pageerror', e => errs.push(e.message));
  // dados movidos para o R2: nada de mapa/, fotos/, tse/ no host do site; contar pedidos/falhas no host de dados
  const pageHost = new URL(BASE).host; let movedOnPages = [], dataReq = 0, dataFail = [];
  page.on('request', r => { const u = new URL(r.url()); if (u.host === pageHost && /^\/(mapa|fotos|tse)\//.test(u.pathname)) movedOnPages.push(u.pathname); if (u.host === 'dados.cademeuvoto.com.br') dataReq++; });
  page.on('response', r => { if (/dados\.cademeuvoto\.com\.br/.test(r.url()) && r.status() >= 400) dataFail.push(r.status() + ' ' + r.url()); });
  page.on('requestfailed', r => { if (/dados\.cademeuvoto\.com\.br/.test(r.url())) dataFail.push((r.failure() || {}).errorText + ' ' + r.url()); });
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
  let NMUN = 20; try { NMUN = JSON.parse(fs.readFileSync(UF === 'se' ? `${SITE}/mapa/mun-index.json` : `${SITE}/mapa/${UF}/mun-index.json`, 'utf8')).muns.length; } catch (_) {}
  const MINF = Math.min(20, NMUN - 1);
  await page.goto(BASE + '#inicio', { waitUntil: 'domcontentloaded' }); await settle(3000);
  const meta = await page.evaluate(u => ({ ...UF_REGISTRY[u] }), UF);
  const D = await page.evaluate(() => UF_DESTAQUES);
  ok('chip ' + UF + ' disponível no seletor', await page.$(`#uf-picker a.is-ready[data-uf="${UF}"]`) != null);
  ok('site usa DATA_BASE do R2', (await page.evaluate(() => window.DATA_BASE)) === 'https://dados.cademeuvoto.com.br');
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
  if (UF !== 'se') forb.push('Sergipe', 'Alese', 'Aracaju');
  // homônimos: nome de destaque de outra UF que também é candidato nesta UF (ex.: "Allyson" no RN e "Allyson Elias" no RJ) não conta
  const own = [];
  for (const c of (UF === 'df' ? [3, 5, 6, 8] : [3, 5, 6, 7])) { try { const d = JSON.parse(fs.readFileSync(`${SITE}/tse/ele2026/6259/dados/${UF}/${UF}-c${String(c).padStart(4, '0')}-e006259-u.json`, 'utf8'));
    for (const a of d.carg[0].agr || []) for (const p of a.par || []) for (const x of p.cand || []) own.push(fold(x.nmu || x.nm || '')); } catch (_) {} }
  for (let i = forb.length - 1; i >= 0; i--) if (own.some(o => o.includes(fold(forb[i])))) forb.splice(i, 1);
  const badPrep = new RegExp(`(^|[^\\wÀ-ú])(de|em|De|Em) ${meta.nome}(?![\\wÀ-ú])`);
  const DF_BAD = /Assembleia|Estadua|estadua|[Mm]unic[íi]pio/;
  const views = ['inicio', 'governo', 'senado', 'presidente', 'federais', 'estaduais', 'suplentes'];
  for (const v of views) {
    await clickTab(v);
    let t = await viewText(v); if (v === 'inicio') t = t.replace(/Começamos por Sergipe[^\n]*/, '').replace(/ESCOLHA O ESTADO[\s\S]*?(estados\s*EM BREVE|Abrir o Mapa de Vota[çc][ãa]o)/i, ''); const ft = fold(t);
    const hit = forb.filter(n => ft.includes(fold(n)));
    ok(`[${v}] uf no hash`, (await hashUf()) === UF);
    ok(`[${v}] sem dados de outra UF`, hit.length === 0, hit.join(', '));
    if (meta.prep && meta.prep !== 'de') ok(`[${v}] preposição`, !badPrep.test(t), (t.match(badPrep) || [])[0]);
    if (UF === 'df') { const bad = t.match(DF_BAD); ok(`[${v}] DF: sem Assembleia/Estadual/município`, !bad, bad && bad[0]); }
    if (UF === 'df' && v === 'estaduais') ok('[estaduais] DF: Câmara Legislativa / Distritais', /Câmara Legislativa/.test(t) && /Distrita/.test(t));
    if (v === 'governo' && !C) { await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(800); await shot(`${OUT}/${UF}-governo.png`); ok('[governo] SE carregado', /Governador/.test(t) && /votos/.test(t)); }
    if (v === 'governo' && C) {
      const g = C.cargos.governador.candidatos;
      ok('[governo] votos 1º colocado = TSE', t.includes(fmt(g[0].votos)), g[0].nome + ' ' + fmt(g[0].votos));
      ok('[governo] votos 2º colocado = TSE', t.includes(fmt(g[1].votos)), g[1].nome + ' ' + fmt(g[1].votos));
      if (g[0].sit === '2º turno') ok('[governo] selo 2º TURNO', /2º TURNO/.test(t));
      else ok('[governo] sem selo 2º turno indevido', !/2º TURNO/.test(t));
      await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(800);
      await shot(`${OUT}/${UF}-governo.png`);
    }
    if (v === 'senado' && C) { const s = C.cargos.senado.candidatos.filter(x => x.eleito); ok('[senado] eleitos = TSE', s.every(x => t.includes(fmt(x.votos))), s.map(x => x.nome + ' ' + fmt(x.votos)).join(', ')); }
    if (v === 'federais' || v === 'estaduais') {
      const n = await page.evaluate(v => { const c = [...document.querySelectorAll('#view-' + v + ' section.card.alese')].find(x => v === 'federais' ? x.classList.contains('hemi-fed') : !x.classList.contains('hemi-fed')); return c ? c.querySelectorAll('svg circle.cad').length : -1; }, v);
      const exp = C ? (v === 'federais' ? C.cadeiras.camara : C.cadeiras.assembleia) : (v === 'federais' ? meta.fed : meta.est);
      ok(`[${v}] hemiciclo ${exp} cadeiras (agr.vag TSE)`, n === exp, 'desenhadas ' + n);
      ok(`[${v}] sem aviso de soma`, !t.includes('soma das vagas'));
    }
  }
  // mapa via CTA da home
  await clickTab('inicio'); await page.click('#cta-mapa'); await settle(6000);
  ok('[mapa] uf no hash', (await hashUf()) === UF);
  const mp = await page.evaluate((MINF) => { const s = [...document.querySelectorAll('#view-mapa svg')].find(x => x.querySelectorAll('path[data-i]').length > MINF || x.querySelectorAll('circle[data-i]').length > MINF); if (!s) return null;
    const gb = [...s.querySelectorAll('.choro-lab')].map(g => { const b = [...g.querySelectorAll('text')].map(t => t.getBBox()); return { x1: Math.min(...b.map(q => q.x)), y1: Math.min(...b.map(q => q.y)), x2: Math.max(...b.map(q => q.x + q.width)), y2: Math.max(...b.map(q => q.y + q.height)) }; });
    let ov = 0; for (let i = 0; i < gb.length; i++) for (let j = i + 1; j < gb.length; j++) { const A = gb[i], B = gb[j]; if (A.x1 < B.x2 && B.x1 < A.x2 && A.y1 < B.y2 && B.y1 < A.y2) ov++; }
    return { paths: s.querySelectorAll('path[data-i], circle[data-i]').length, labels: gb.length, ov, text: document.getElementById('view-mapa').innerText.slice(0, 4000) }; }, MINF);
  ok('[mapa] coroplético carregado', mp && mp.paths === NMUN, mp && (mp.paths + (UF === 'df' ? ' zonas eleitorais, ' : ' municípios, ') + mp.labels + ' rótulos'));
  ok('[mapa] rótulos sem sobreposição', mp && mp.ov === 0, mp && ('sobreposições ' + mp.ov));
  // mapa: município → zona → bairro → colégio → seção
  let secReq = 0; const onSec = r => { if (/\/secao\//.test(r.url())) secReq++; }; page.on('request', onSec);
  await page.click('#view-mapa .mapa-tree > details:first-of-type > summary'); await page.waitForTimeout(1500);
  for (let d = 0; d < 5; d++) {
    const clicked = await page.evaluate(() => { const open = [...document.querySelectorAll('#view-mapa .mapa-tree details[open]')]; const last = open[open.length - 1]; if (!last) return false; const nxt = last.querySelector('.mv-nested details:not([open]) > summary'); if (!nxt) return false; nxt.click(); return true; });
    if (!clicked) break; await page.waitForTimeout(1800);
  }
  const drill = await page.evaluate(() => { const open = [...document.querySelectorAll('#view-mapa .mapa-tree details[open]')]; const last = open[open.length - 1]; return { depth: open.length, path: open.map(d => (d.querySelector('summary') || {}).textContent.trim().slice(0, 40)).join(' › '), leaf: last ? (last.querySelector('.mv-nested') || last).innerText.slice(0, 300) : '' }; });
  ok('[mapa] drill até seção', drill.depth >= (UF === 'df' ? 3 : 4) && /se[cç][aã]o/i.test(drill.leaf + drill.path) && secReq > 0, drill.path + ' :: ' + drill.leaf.replace(/\n/g, ' ').slice(0, 90) + ' · pedidos secao=' + secReq);
  page.off('request', onSec);
  // PDF do candidato (foto + mapa) a partir do mapa
  try {
    await page.click('#view-mapa button[data-pdf-from="mapa"]'); await settle(3000);
    ok('[mapa→relatórios] mantém uf', (await hashUf()) === UF);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 240000 }), page.click('#rel-pdf-btn')]);
    const f = `/tmp/e2e-${UF}-cand.pdf`; await dl.saveAs(f);
    const cp = require('child_process');
    const txt = cp.execSync(`pdftotext -l 2 ${f} - 2>/dev/null`).toString();
    const imgs = cp.execSync(`pdfimages -list ${f} 2>/dev/null | awk 'NR>2 && $3=="image"' | wc -l`).toString().trim();
    if (UF === 'df') { const bad = txt.match(DF_BAD); ok('[mapa] PDF do candidato DF: sem Assembleia/Estadual/município', !bad, bad && bad[0]); }
    ok('[mapa] PDF do candidato (foto + mapa do R2)', fs.statSync(f).size > 20000 && txt.includes(meta.nome) && Number(imgs) >= 2, (fs.statSync(f).size / 1024).toFixed(0) + ' KB, imagens: ' + imgs);
  } catch (e) { ok('[mapa] PDF do candidato', false, String(e).slice(0, 120)); }
  for (const v of ['comparar', 'relatorios']) {
    const a = await page.$(`a[href^="#${v}"]:visible`);
    if (a) { await a.click(); } else { await page.evaluate(v => { location.hash = '#' + v; }, v); }
    await settle(2500);
    const t = await viewText(v);
    ok(`[${v}] uf no hash`, (await hashUf()) === UF);
    ok(`[${v}] nome da UF`, t.includes(meta.nome));
    if (meta.prep && meta.prep !== 'de') ok(`[${v}] preposição`, !badPrep.test(t), (t.match(badPrep) || [])[0]);
  }
  // Relatórios: PDF resumo da eleição (capa com nome/preposição da UF)
  try {
    await page.check('#view-relatorios input[value="resumo"]').catch(() => {});
    await page.waitForTimeout(800);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 180000 }), page.click('#rel-pdf-btn')]);
    const f = `/tmp/e2e-${UF}-resumo.pdf`; await dl.saveAs(f);
    const txt = require('child_process').execSync(`pdftotext -l 3 ${f} - 2>/dev/null`).toString().replace(/\s+/g, ' ');
    const capa = UF === 'df' ? 'Distrito Federal' : 'Estado ' + (meta.prep || 'de') + ' ' + meta.nome;
    if (UF === 'df') { const bad = txt.match(/Estado do Distrito|Assembleia|Estadua|[Mm]unic[íi]pio/); ok('[relatorios] PDF resumo DF: termos do DF', !bad && /Câmara Legislativa|Distrita/.test(txt), bad && bad[0]); }
    ok('[relatorios] PDF resumo', txt.includes(capa), capa + ' · ' + (fs.statSync(f).size / 1024).toFixed(0) + ' KB');
  } catch (e) { ok('[relatorios] PDF resumo', false, String(e).slice(0, 120)); }
  // isolamento: troca para as outras UFs e volta
  for (const o of OTHERS) {
    await pickUf(o); await clickTab('governo');
    const t = fold(await viewText('governo')); const myWin = D[UF] ? fold(D[UF].gov[0].nome) : '\u0000';
    const theirs = o === 'se' ? null : fold(D[o].gov[0].nome);
    ok(`[isolamento ${o}] governo mostra ${o.toUpperCase()} e não ${UF.toUpperCase()}`, (theirs ? t.includes(theirs) : true) && !t.includes(myWin) && (await hashUf()) === o);
    const s2 = await statusOk(); ok(`[isolamento ${o}] sem alerta`, !/erro|pendente/.test(s2.cls), s2.txt);
  }
  await pickUf(UF); await clickTab('governo');
  ok('[volta] governo ' + UF, D[UF] ? fold(await viewText('governo')).includes(fold(D[UF].gov[0].nome)) : (await hashUf()) === UF);
  ok('dados vêm do R2 (dados.cademeuvoto.com.br)', dataReq > 0 && dataFail.length === 0, dataReq + ' pedidos, falhas ' + dataFail.length + ' ' + dataFail.slice(0, 2).join(' '));
  ok('nenhum pedido de mapa/fotos/tse ao Pages', movedOnPages.length === 0, movedOnPages.length + ' ' + movedOnPages.slice(0, 3).join(' '));
  ok('zero pedidos ao TSE no navegador', tse.length === 0, tse.length + ' pedidos ' + tse.slice(0, 3).join(' '));
  ok('sem erros JS', errs.length === 0, errs.slice(0, 3).join(' | '));
  fs.writeFileSync(`${OUT}/${UF}-e2e.json`, JSON.stringify(res, null, 1));
  console.log(`RESUMO ${UF}: ${res.checks.length} ok, ${res.fails.length} falhas`);
  await browser.close();
})().catch(e => { console.error('ERRO', e); process.exit(1); });
