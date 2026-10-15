// "Mais votados no seu bairro" em destaque: botão grande logo abaixo de "Compartilhar no WhatsApp" (topo da home), item no topo do menu,
// item na navegação de computador; 360 px sem rolagem lateral; iPhone com notch e banner de instalação; nada de localização sem toque.
const { chromium, devices } = require('/workspace/eleicoes-se/assinaturas/api/test/sem-analytics.cjs')(require('/workspace/eleicoes-se/build/node_modules/playwright-core'));
const fs = require('fs');
const LIVE = !!process.env.BASE && !/localhost/.test(process.env.BASE);
const SITE = LIVE ? process.env.BASE : 'http://localhost:8080/?api=http://localhost:8787&dados=http://127.0.0.1:8766';
const OUT = process.env.OUT || '/workspace/eleicoes-se/rebrand/bairro/destaque'; fs.mkdirSync(OUT, { recursive: true });
let fails = 0, total = 0; const erros = [], tse = [];
const ok = (n, c, info) => { total++; if (!c) fails++; console.log((c ? '✔ ' : '✘ ') + n + (c ? '' : ' → ' + JSON.stringify(info))); };
const CONTA_GEO = () => { const g = navigator.geolocation; window.__geo = { get: 0, watch: 0 }; if (!g) return; const c = g.getCurrentPosition.bind(g), w = g.watchPosition.bind(g); g.getCurrentPosition = (...a) => { window.__geo.get++; return c(...a); }; g.watchPosition = (...a) => { window.__geo.watch++; return w(...a); }; };
const PIXEL = devices['Pixel 7'], IPHONE = devices['iPhone 14 Pro Max'];
const P360 = { ...devices['Pixel 7'], viewport: { width: 360, height: 740 } };
async function abrir(browser, dev, { insets, viewport } = {}) {
  const ctx = await browser.newContext({ ...dev, ...(viewport ? { viewport } : {}), serviceWorkers: 'block', geolocation: { latitude: -10.96921, longitude: -37.05912 }, permissions: ['geolocation'] });
  await ctx.addInitScript(CONTA_GEO);
  const page = await ctx.newPage();
  page.on('pageerror', e => erros.push(e.message));
  page.on('console', m => { if (m.type() === 'error') erros.push(m.text() + ' @ ' + ((m.location() || {}).url || '')); });
  page.on('request', r => { if (/(^|\.)tse\.jus\.br$/.test(new URL(r.url()).hostname)) tse.push(r.url()); });
  if (insets) { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { left: 0, leftMax: 0, right: 0, rightMax: 0, ...insets } }); }
  await page.goto(SITE, { waitUntil: 'load' });
  await page.waitForSelector('#bx-home-card'); await page.waitForTimeout(1200);
  return { ctx, page };
}
const semLateral = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
// desenha a barra de status do iPhone (Dynamic Island) e a barra de gestos só para a foto
const NOTCH = () => { const d = document.createElement('div'); d.id = 'fake-notch'; d.innerHTML = '<div style="position:fixed;left:0;right:0;top:0;height:59px;z-index:2147483647;pointer-events:none;color:#fff;font:600 17px -apple-system,system-ui,sans-serif"><span style="position:absolute;left:44px;top:19px">05:09</span><span style="position:absolute;left:50%;top:11px;transform:translateX(-50%);width:126px;height:37px;border-radius:20px;background:#000"></span><span style="position:absolute;right:38px;top:19px;font-size:14px">5G ▮</span></div><div style="position:fixed;left:50%;bottom:8px;transform:translateX(-50%);width:140px;height:5px;border-radius:3px;background:#fff;z-index:2147483647;pointer-events:none"></div>'; document.body.appendChild(d); };
async function foto(page, arq, notch) { if (notch) await page.evaluate(NOTCH); await page.screenshot({ path: arq }); if (notch) await page.evaluate(() => { const d = document.getElementById('fake-notch'); if (d) d.remove(); }); }

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  for (const [nome, dev, insets] of [['pixel', PIXEL, null], ['pixel-360', P360, null], ['iphone-notch', IPHONE, { top: 59, topMax: 59, bottom: 34, bottomMax: 34 }]]) {
    const { ctx, page } = await abrir(browser, dev, { insets });
    const info = await page.evaluate(() => {
      const b = document.getElementById('bx-home-card'), sec = document.getElementById('sec-resultados-title'), wa = document.querySelector('[data-wa-share="inicio"]');
      const r = b.getBoundingClientRect(), main = b.parentElement.getBoundingClientRect(), cs = getComputedStyle(b), rw = wa.getBoundingClientRect();
      const wrap = wa.closest('.hero-actions');
      return { abaixoWa: wrap.nextElementSibling === b && r.top >= rw.bottom && r.top - rw.bottom <= 32, gap: Math.round(r.top - rw.bottom),
        antesResultados: !!(b.compareDocumentPosition(sec) & Node.DOCUMENT_POSITION_FOLLOWING), w: r.width, wPai: main.width, h: r.height, topoPagina: Math.round(r.top + scrollY),
        fundo: cs.backgroundImage, txt: b.textContent.replace(/\s+/g, ' ').trim(), qtd: document.querySelectorAll('#view-inicio a[href^="#bairro"]').length, sec: sec.textContent };
    });
    ok(`${nome}: botão logo abaixo de "Compartilhar no WhatsApp" (${info.gap}px), no topo da home`, info.abaixoWa && info.antesResultados, info);
    ok(`${nome}: só uma entrada na home`, info.qtd === 1, info.qtd);
    ok(`${nome}: largura total no celular e área de toque grande`, Math.abs(info.w - info.wPai) <= 2 && info.h >= 72, info);
    ok(`${nome}: texto, subtítulo e gradiente azul`, /Mais votados no seu bairro/.test(info.txt) && /Veja quem foram os mais votados onde você está/.test(info.txt) && /gradient/.test(info.fundo), info.txt);
    ok(`${nome}: sem rolagem lateral`, await semLateral(page));
    // foto: botão em contexto, com os botões do topo (Mapa, Planos, WhatsApp) logo acima
    await page.evaluate(() => { const a = document.querySelector('.hero-actions'); const y = a.getBoundingClientRect().top + scrollY - (innerHeight * 0.2); scrollTo(0, Math.max(0, y)); });
    await page.waitForTimeout(400);
    if (nome === 'iphone-notch') {
      const ban = await page.waitForSelector('#cmv-pwa', { timeout: 8000 }).catch(() => null);
      ok('iPhone: banner "Instale o app" apareceu (Safari)', !!ban);
      const sobre = await page.evaluate(() => { const b = document.getElementById('bx-home-card').getBoundingClientRect(), p = document.getElementById('cmv-pwa'); if (!p) return { sem: true }; const q = p.getBoundingClientRect(); return { b: [b.top, b.bottom], q: [q.top, q.bottom], cruza: b.bottom > q.top && b.top < q.bottom }; });
      ok('iPhone: banner de instalação não cobre o botão', sobre.sem || !sobre.cruza, sobre);
      const topo = await page.evaluate(() => document.getElementById('bx-home-card').getBoundingClientRect().top);
      ok('iPhone: botão abaixo do cabeçalho fixo (fora do notch)', topo >= 59 + 56, topo);
    }
    await foto(page, `${OUT}/${nome}-1-home-botao.png`, nome === 'iphone-notch');
    // menu aberto
    await page.evaluate(() => scrollTo(0, 0));
    await page.click('#nav-toggle');
    await page.waitForSelector('#nav-drawer:not([hidden]) a.drawer-destaque', { timeout: 5000 });
    const m = await page.evaluate(() => { const links = [...document.querySelectorAll('#nav-drawer .drawer-panel a')]; const d = document.querySelector('#nav-drawer a.drawer-destaque'); return { primeiro: links[0] === d, txt: d.textContent.trim(), h: d.getBoundingClientRect().height, n: document.querySelectorAll('#nav-drawer a[href^="#bairro"]').length }; });
    ok(`${nome}: menu com "Mais votados no seu bairro" no topo, ícone e "Novo"`, m.primeiro && /Mais votados no seu bairro/.test(m.txt) && /Novo/.test(m.txt) && m.h >= 48 && m.n === 1, m);
    ok(`${nome}: menu aberto sem rolagem lateral`, await semLateral(page));
    await page.waitForTimeout(300);
    await foto(page, `${OUT}/${nome}-2-menu-aberto.png`, nome === 'iphone-notch');
    await page.click('#nav-drawer a.drawer-destaque');
    await page.waitForSelector('#bx-consent');
    ok(`${nome}: menu abre a tela de explicação sem pedir localização`, (await page.evaluate(() => window.__geo.get + window.__geo.watch)) === 0);
    // botão da home também
    await page.evaluate(() => { location.hash = '#inicio'; }); await page.waitForSelector('#bx-home-card', { state: 'visible' });
    await page.click('#bx-home-card'); await page.waitForSelector('#bx-consent');
    ok(`${nome}: botão abre a tela de explicação; localização só após "Usar minha localização"`, (await page.evaluate(() => window.__geo.get + window.__geo.watch)) === 0);
    const bn = await page.evaluate(() => { const b = document.querySelector('.bottom-nav, #bottom-nav, nav.bn'); return b ? b.querySelectorAll('a').length : null; });
    ok(`${nome}: barra inferior continua com 5 abas`, bn === null || bn === 5, bn);
    await ctx.close();
  }
  // resultado grátis: botão "Mostrar votos" (cadeado) em cada linha → fluxo de assinatura; votos nunca baixados
  for (const [nome, dev, insets] of [['pixel-360', P360, null], ['iphone-notch', IPHONE, { top: 59, topMax: 59, bottom: 34, bottomMax: 34 }]]) {
    const { ctx, page } = await abrir(browser, dev, { insets });
    const dados = []; page.on('request', r => { if (/\/dados\/|\/top3\/|\/det\//.test(new URL(r.url()).pathname)) dados.push(r.url()); });
    await page.evaluate(() => { location.hash = '#bairro'; }); await page.waitForSelector('#bx-consent');
    await page.click('#bx-consent [data-bx=picker]'); await page.waitForSelector('#bx-picker');
    await page.selectOption('#bx-picker [data-p=uf]', 'se');
    await page.waitForFunction(() => { const s = document.querySelector('#bx-picker [data-p=cd]'); return s && !s.disabled && [...s.options].some(o => o.value === '31054'); });
    await page.selectOption('#bx-picker [data-p=cd]', '31054');
    await page.waitForFunction(() => { const s = document.querySelector('#bx-picker [data-p=b]'); return s && !s.disabled && s.options.length > 10; });
    await page.selectOption('#bx-picker [data-p=b]', { label: 'Farolandia' });
    await page.click('#bx-picker [data-bx=ver]'); await page.waitForSelector('#bx-c5 .bx-lista li'); await page.waitForTimeout(1500);
    const r = await page.evaluate(() => {
      const lis = [...document.querySelectorAll('#view-bairro .bx-lista li')];
      const sem = lis.filter(li => [...li.querySelectorAll('[data-bx-votos]')].filter(x => x.offsetParent !== null).length !== 1).length;
      const sobrepoe = lis.some(li => { const n = li.querySelector('.bx-nome').getBoundingClientRect(), d = li.querySelector('.bx-dir').getBoundingClientRect(); return n.right > d.left + 1; });
      const fora = lis.some(li => { const a = li.getBoundingClientRect(), d = li.querySelector('.bx-dir').getBoundingClientRect(); return d.right > a.right + 1; });
      const vis = [...document.querySelectorAll('[data-bx-votos]')].filter(x => x.offsetParent !== null); const b = vis[0].getBoundingClientRect();
      return { linhas: lis.length, sem, votos: document.querySelectorAll('.bx-votos').length, sobrepoe, fora, alvo: [Math.round(b.width), Math.round(b.height)], cadeado: !!vis[0].querySelector('svg'), txt: vis[0].textContent.trim() };
    });
    ok(`${nome}: "Mostrar votos" com cadeado em todas as linhas (top 3 e eleitos, todos os cargos)`, r.linhas >= 15 && r.sem === 0 && r.cadeado && r.txt === 'Mostrar votos', r);
    ok(`${nome}: nenhum voto na tela e nenhum arquivo de votos baixado`, r.votos === 0 && dados.length === 0, { r, dados });
    ok(`${nome}: linhas limpas (nome não encosta no botão, nada sai da linha), sem rolagem lateral`, !r.sobrepoe && !r.fora && (await semLateral(page)), r);
    await page.evaluate(() => { const s = document.getElementById('bx-ver'); scrollTo(0, s.getBoundingClientRect().top + scrollY - 70); });
    await page.waitForTimeout(300);
    await foto(page, `${OUT}/${nome}-3-resultado-gratis-mostrar-votos.png`, nome === 'iphone-notch');
    await page.click('#bx-ver [data-bx-votos]:visible >> nth=0');
    await page.waitForSelector('#cmv-modal', { timeout: 5000 });
    ok(`${nome}: sem login → abre o login (depois segue para a assinatura)`, /Entre para assinar/.test(await page.textContent('#cmv-modal')), await page.textContent('#cmv-modal'));
    await page.waitForTimeout(300);
    await foto(page, `${OUT}/${nome}-4-apos-mostrar-votos-sem-login.png`, nome === 'iphone-notch');
    if (!LIVE && nome === 'iphone-notch') {
      // conta grátis (wrangler dev local; IP falso só aqui por causa do limite de cadastros por rede)
      const ip = `10.88.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
      await page.route('http://localhost:8787/**', rt => rt.continue({ headers: { ...rt.request().headers(), 'cf-connecting-ip': ip } }));
      const email = `votos-${Date.now().toString(36)}@teste.local`;
      await page.click('.cmv-tabs button[data-tab=cadastro]');
      const f = page.locator('form[data-form=cadastro]');
      await f.locator('input[name=nome]').fill('Bia Grátis'); await f.locator('input[name=email]').fill(email);
      await f.locator('input[name=cidade]').fill('Aracaju'); await f.locator('select[name=uf]').selectOption('se');
      await f.locator('select[name=perfil]').selectOption('eleitor').catch(() => f.locator('select[name=perfil]').selectOption({ index: 1 }));
      await f.locator('input[name=aceite_termos]').check(); await f.locator('button[type=submit]').click();
      await page.waitForSelector('form[data-form=codigo]:not([hidden])', { timeout: 10000 });
      let cod = null;
      for (let i = 0; i < 20 && !cod; i++) { const j = await (await fetch(`http://localhost:8787/__dev/outbox?to=${encodeURIComponent(email)}`)).json(); const m = j.emails.length && j.emails[j.emails.length - 1].text.match(/\b(\d{6})\b/); cod = m && m[1]; if (!cod) await new Promise(z => setTimeout(z, 300)); }
      await page.fill('form[data-form=codigo] input[name=codigo]', cod);
      // depois do login, o próprio fluxo segue para a assinatura (STRIPE_ENABLED=0 → "abre em breve")
      await page.waitForFunction(() => /abre em breve/.test((document.getElementById('cmv-modal') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
      ok('grátis: após entrar, segue para a assinatura (Stripe desligado → "abre em breve")', /abre em breve/.test(await page.textContent('#cmv-modal').catch(() => '')));
      await page.keyboard.press('Escape'); await page.evaluate(() => { const m = document.getElementById('cmv-modal'); if (m && m._close) m._close(); else if (m) m.remove(); });
      await page.waitForTimeout(500);
      ok('grátis logado: continua sem votos', (await page.locator('.bx-votos').count()) === 0 && (await page.locator('[data-bx-votos]').count()) >= 15);
      await page.click('#bx-ver [data-bx-votos]:visible >> nth=0');
      await page.waitForFunction(() => /abre em breve/.test((document.getElementById('cmv-modal') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
      ok('grátis logado: "Mostrar votos" abre a assinatura direto', /abre em breve/.test(await page.textContent('#cmv-modal').catch(() => '')));
      await page.waitForTimeout(300);
      await foto(page, `${OUT}/${nome}-5-apos-mostrar-votos-logado-gratis.png`, true);
      ok('grátis logado: nenhum arquivo de votos baixado', dados.length === 0, dados);
    }
    await ctx.close();
  }

  // computador: item na navegação principal, cabeçalho sem estourar
  for (const w of [1061, 1100, 1280, 1366]) {
    const { ctx, page } = await abrir(browser, { viewport: { width: w, height: 860 } });
    const n = await page.evaluate(() => { const a = document.querySelector('.primary-nav a.nav-destaque'); const h = document.querySelector('.hdr-inner'); return { vis: !!a && a.offsetParent !== null, primeiro: a === document.querySelector('.primary-nav a'), txt: a && a.textContent.trim(), cabe: h.scrollWidth <= h.clientWidth + 1 }; });
    ok(`computador ${w}px: "Seu bairro" em destaque na navegação, cabeçalho cabe`, n.vis && n.primeiro && n.cabe, n);
    ok(`computador ${w}px: sem rolagem lateral`, await semLateral(page));
    if (w === 1366) await page.screenshot({ path: `${OUT}/computador-1366-home.png` });
    await ctx.close();
  }
  // 503 de /stripe/checkout é a resposta esperada com STRIPE_ENABLED=0 (o mesmo do botão Assinar de hoje), não um erro de JS
  const esperados = erros.filter(t => /503/.test(t) && /\/stripe\/checkout/.test(t));
  console.log('503 esperados de /stripe/checkout (Stripe desligado):', esperados.length);
  ok('sem erros de console (fora o 503 esperado do Stripe desligado)', erros.filter(t => !/abacus/.test(t) && !esperados.includes(t)).length === 0, erros.slice(0, 5));
  ok('zero pedidos ao TSE', tse.length === 0, tse);
  await browser.close();
  console.log(`${total - fails}/${total} OK (destaque, ${SITE})`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
