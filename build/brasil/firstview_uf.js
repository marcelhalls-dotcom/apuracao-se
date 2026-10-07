// Mede a 1ª visita (cache vazio) por UF: pedidos e bytes transferidos por view.
// node firstview_uf.js <base> <uf> [views=inicio,governo,mapa]  → imprime JSON e grava <uf>-firstview.json
const path = require('path'), fs = require('fs');
let pw; try { pw = require(process.env.PW_CORE || 'playwright-core'); } catch (_) { pw = require('/workspace/eleicoes-se/build/node_modules/playwright-core'); }
const BASE = process.argv[2], UF = process.argv[3], VIEWS = (process.argv[4] || 'inicio,governo,mapa').split(',');
const SITE = process.env.CMV_SITE || path.resolve(__dirname, '..', '..'), OUT = process.env.CMV_OUT || path.resolve(SITE, '..', 'rebrand', 'brasil');
(async () => {
  const browser = await pw.chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const out = { uf: UF, base: BASE, views: {} };
  for (const v of VIEWS) {
    // cada view numa visita nova com cache vazio (pior caso: link direto)
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page); await cdp.send('Network.enable');
    const reqs = new Map(); let bytes = 0, dataBytes = 0, dataN = 0, n = 0, tse = 0, pagesData = 0; const big = [];
    cdp.on('Network.requestWillBeSent', e => { reqs.set(e.requestId, e.request.url); });
    cdp.on('Network.loadingFinished', e => { const u = reqs.get(e.requestId) || ''; if (!u || u.startsWith('data:')) return; n++; bytes += e.encodedDataLength;
      if (/dados\.cademeuvoto/.test(u)) { dataN++; dataBytes += e.encodedDataLength; big.push([e.encodedDataLength, u.replace(/^https:\/\/dados\.cademeuvoto\.com\.br\//, '')]); }
      if (/tse\.jus\.br/.test(u)) tse++;
      try { const p = new URL(u); if (p.host === new URL(BASE).host && /^\/(mapa|fotos|tse)\//.test(p.pathname)) pagesData++; } catch (_) {} });
    const t0 = Date.now();
    await page.goto(BASE + '#' + v + '?uf=' + UF, { waitUntil: 'networkidle', timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    const ms = Date.now() - t0;
    big.sort((a, b) => b[0] - a[0]);
    out.views[v] = { pedidos: n, kb: Math.round(bytes / 1024), dados_pedidos: dataN, dados_kb: Math.round(dataBytes / 1024), tse, pages_dados: pagesData, ms, maiores: big.slice(0, 4).map(([b, u]) => u + ' ' + Math.round(b / 1024) + 'KB') };
    await ctx.close();
  }
  console.log(JSON.stringify(out));
  fs.writeFileSync(`${OUT}/${UF}-firstview.json`, JSON.stringify(out, null, 1));
  await browser.close();
})().catch(e => { console.error('ERRO', e); process.exit(1); });
