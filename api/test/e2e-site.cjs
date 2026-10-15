// E2E no navegador (Playwright + Chrome): usuário grátis e usuário pago (cortesia manual), tudo local.
// Pré-requisitos: wrangler dev (:8787), dados públicos pós-separação (:8766), site da branch assinaturas (:8080), mock do roteador de IA (:8799).
const { chromium } = require('/workspace/eleicoes-se/assinaturas/api/test/sem-analytics.cjs')(require('/workspace/eleicoes-se/build/node_modules/playwright-core'));
const fs = require('fs');
const { execFileSync } = require('child_process');
const API = 'http://localhost:8787';
const SITE = 'http://localhost:8080/?api=http://localhost:8787&dados=http://127.0.0.1:8766';
const OUT = __dirname + '/out';
fs.mkdirSync(OUT, { recursive: true });
const ADMIN_TOKEN = (fs.readFileSync(__dirname + '/../.dev.vars', 'utf8').match(/^ADMIN_TOKEN=(.*)$/m) || [])[1];
const RUN = Date.now().toString(36);
const res = { quando: new Date().toISOString(), checks: [] };
let fails = 0;
const ok = (nome, cond, info) => { res.checks.push({ nome, ok: !!cond, info: cond ? undefined : info }); if (!cond) fails++; console.log((cond ? '✔ ' : '✘ ') + nome + (cond ? '' : ' → ' + JSON.stringify(info))); };
const codigoDe = async email => {
  for (let i = 0; i < 20; i++) {
    const j = await (await fetch(`${API}/__dev/outbox?to=${encodeURIComponent(email)}`)).json();
    const m = j.emails.length && j.emails[j.emails.length - 1].text.match(/\b(\d{6})\b/);
    if (m) return m[1];
    await new Promise(r => setTimeout(r, 300));
  }
  return null;
};
const pdfText = file => execFileSync('pdftotext', ['-layout', file, '-']).toString();

async function novaPagina(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const log = { dados: [], privadoPublico: [], erros: [] };
  page.on('response', r => {
    const u = r.url();
    if (u.startsWith(API + '/dados/')) log.dados.push([u.slice(API.length), r.status()]);
    if (/127\.0\.0\.1:8766\/mapa\/(?:[a-z]{2}\/)?(?:[1-7]\/\d+\.json|secao\/|geo-loc)/.test(u)) log.privadoPublico.push(u);
  });
  page.on('pageerror', e => log.erros.push(e.message));
  return { ctx, page, log };
}
async function cadastrar(page, nome, email) {
  await page.click('#cmv-entrar');
  await page.click('.cmv-tabs button[data-tab=cadastro]');
  const f = page.locator('form[data-form=cadastro]');
  await f.locator('input[name=nome]').fill(nome);
  await f.locator('input[name=email]').fill(email);
  await f.locator('input[name=cidade]').fill('Aracaju');
  await f.locator('select[name=uf]').selectOption('se');
  await f.locator('select[name=perfil]').selectOption('campanha');
  await f.locator('input[name=aceite_termos]').check();
  await f.locator('button[type=submit]').click();
  await page.waitForSelector('form[data-form=codigo]:not([hidden])', { timeout: 10000 });
  const cod = await codigoDe(email);
  await page.fill('form[data-form=codigo] input[name=codigo]', cod); // envia sozinho ao completar 6 dígitos
  await page.waitForSelector('#cmv-modal', { state: 'detached', timeout: 10000 });
}
async function irMapa(page, hash) {
  await page.evaluate(h => { location.hash = h; }, hash);
  await page.waitForSelector('#mapa-root .mapa-tree details', { timeout: 30000 });
  await page.waitForTimeout(800);
}
async function baixar(page, botao, arquivo) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), page.click(botao)]);
  const p = OUT + '/' + arquivo;
  await dl.saveAs(p);
  return p;
}
// prévia do relatório: grátis/anônimo = só na tela (sem PDF, sem link, sem blob, sem download)
async function previa(page) {
  let dls = 0; const h = () => dls++; page.on('download', h);
  await page.click('#rel-preview-btn');
  await page.waitForSelector('#rel-preview .rel-so-tela, #rel-preview .rel-pdf-preview', { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => { const b = document.getElementById('rel-preview'); return { soTela: !!b.querySelector('.rel-so-tela'), pdf: !!b.querySelector('.rel-pdf-preview'), blobs: document.querySelectorAll('a[href^="blob:"],object[data^="blob:"],iframe[src^="blob:"],embed[src^="blob:"]').length, baixar: [...b.querySelectorAll('a,button')].filter(x => /baixar|abrir pdf/i.test(x.textContent)).length, texto: b.innerText.slice(0, 160) }; });
  page.off('download', h); r.downloads = dls; return r;
}
const previaSoTela = r => r.soTela && !r.pdf && r.blobs === 0 && r.baixar === 0 && r.downloads === 0;
async function irRelatorio(page, hash) {
  await page.evaluate(h => { location.hash = h; }, hash);
  await page.waitForSelector('#rel-pdf-btn', { timeout: 20000 });
  await page.waitForTimeout(1500);
}

(async () => {
  await fetch(API + '/__dev/reset-limites', { method: 'POST', headers: { Origin: 'http://localhost:8080' } }); // limites por IP: o navegador local é sempre 127.0.0.1
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });

  /* ======================= USUÁRIO GRÁTIS ======================= */
  {
    const { ctx, page, log } = await novaPagina(browser);
    await page.goto(SITE + '#inicio', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#cmv-entrar');
    ok('grátis: cabeçalho mostra “Entrar”', (await page.textContent('#cmv-entrar')).trim() === 'Entrar');
    await irRelatorio(page, '#relatorios?uf=se&t=candidato&c=3&n=55');
    { const r = await previa(page); ok('anônimo: prévia só na tela (sem PDF, link, blob ou download)', previaSoTela(r), r); }
    await page.evaluate(() => { location.hash = '#inicio'; }); await page.waitForTimeout(500);
    // chat sem login pede conta
    const emailF = `gratis-${RUN}@teste.local`;
    await cadastrar(page, 'Joana Grátis', emailF);
    ok('grátis: cadastro pelo modal + código → logada', /Joana/.test(await page.textContent('#cmv-entrar')));
    const cookies = await ctx.cookies(API);
    const ck = cookies.find(c => c.name === '__Host-cmv');
    ok('cookie de sessão __Host-cmv HttpOnly + Secure no domínio da API', ck && ck.httpOnly && ck.secure && ck.sameSite === 'Lax' && ck.path === '/', ck);

    await irMapa(page, '#mapa?uf=se&c=3&a=55');
    const h3 = await page.textContent('#mapa-root h3');
    ok('grátis: mapa SE por município (sem zona/bairro)', /por município/.test(h3), h3);
    const first = page.locator('#mapa-root .mapa-tree > details').first();
    await first.locator('summary').click();
    await page.waitForTimeout(400);
    const inner = await first.innerText();
    ok('grátis: abrir município mostra aviso da Assinatura, sem zonas', /exclusivo da Assinatura/.test(inner) && !/Zona \d/.test(inner), inner.slice(0, 200));
    await page.screenshot({ path: OUT + '/gratis-mapa-se.png' });
    // DF: zona = nível municipal (público)
    await irMapa(page, '#mapa?uf=df&c=3&a=11');
    const dfTxt = await page.locator('#mapa-root .mapa-tree').first().innerText();
    ok('grátis: DF mostra as zonas eleitorais (nível público)', /ZONA|Zona|Z\d\d/i.test(dfTxt), dfTxt.slice(0, 160));
    const dfFirst = page.locator('#mapa-root .mapa-tree > details').first();
    await dfFirst.locator('summary').click(); await page.waitForTimeout(400);
    ok('grátis: DF abrir zona → aviso (bairro/local/seção são da Assinatura)', /bairro, local de votação e seção é exclusivo/.test(await dfFirst.innerText()));
    await page.screenshot({ path: OUT + '/gratis-mapa-df.png' });
    await page.evaluate(() => { location.hash = '#comparar?uf=se&c=3&a=55&b=10'; });
    await page.waitForSelector('#comparar-root .se-choropleth-grid', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const cmpTxt = await page.locator('#comparar-root').innerText();
    ok('grátis: Comparar A×B por município funciona', /quem venceu o município/.test(cmpTxt) && /ARACAJU/.test(cmpTxt), cmpTxt.slice(0, 200));
    await page.screenshot({ path: OUT + '/gratis-comparar.png' });
    ok('grátis: nenhum arquivo de detalhe foi pedido (nem à API nem ao bucket público)', log.dados.length === 0 && log.privadoPublico.length === 0, log);

    // relatório 1 (PDF)
    await irRelatorio(page, '#relatorios?uf=se&t=candidato&c=3&n=55');
    { const r = await previa(page); ok('grátis: prévia só na tela (sem PDF, link, blob ou download)', previaSoTela(r), r);
      const me0 = (await page.evaluate(() => CMV.refresh())).relatorios; ok('grátis: prévia não gasta cota (0 de 2)', me0 && me0.usados === 0, me0); }
    const pdf1 = await baixar(page, '#rel-pdf-btn', 'gratis-candidato-55.pdf');
    const t1 = pdfText(pdf1);
    ok('grátis: PDF com marca-d’água e “Versão gratuita”', /cademeuvoto\.com\.br/.test(t1) && /versão gratuita/i.test(t1) && /Relatório [0-9a-f]{8}/.test(t1), t1.slice(0, 300));
    ok('grátis: PDF só até município (sem “Zona N —”, sem seções)', !/Zona \d+ —/.test(t1) && !/Conferência: soma das/.test(t1) && /Versão gratuita: votos por município/.test(t1));
    let me = await page.evaluate(() => CMV.refresh());
    ok('grátis: cota 1 de 2 após o 1º PDF', me.relatorios.usados === 1 && me.relatorios.limite === 2, me.relatorios);
    // Excel → aviso de plano
    await page.click('#rel-xlsx-btn');
    await page.waitForSelector('#cmv-modal');
    ok('grátis: botão Excel abre aviso da Assinatura', /Excel é exclusiva da Assinatura/.test(await page.textContent('#cmv-modal')));
    await page.click('#cmv-modal .cmv-x');
    // relatório 2 (comparar municipal) e 3 (bloqueado)
    await irRelatorio(page, '#relatorios?uf=se&t=comparar&c=3&a=55&b=10');
    const pdf2 = await baixar(page, '#rel-pdf-btn', 'gratis-comparar-55x10.pdf');
    ok('grátis: comparação A×B por município gera PDF (conta 1)', /Comparativo por município/.test(pdfText(pdf2)));
    await irRelatorio(page, '#relatorios?uf=se&t=candidato&c=3&n=10');
    await page.click('#rel-pdf-btn');
    await page.waitForSelector('#cmv-modal', { timeout: 10000 });
    const pw = await page.textContent('#cmv-modal');
    ok('grátis: 3º relatório no mês → aviso de cota', /relatórios grátis deste mês/.test(pw), pw);
    await page.screenshot({ path: OUT + '/gratis-cota.png' });
    await page.click('#cmv-modal .cmv-x');
    // chat
    await page.evaluate(() => { const b = document.querySelector('#chat-fab, .chat-fab, [data-chat-open]'); if (b) b.click(); });
    await page.waitForTimeout(500);
    { // assistente é só da Assinatura: conta grátis vê a tela bloqueada, sem campo; a API recusa com 402
      const c = await page.evaluate(() => ({ lock: !!document.getElementById('chat-lock'), form: !document.getElementById('chat-form').hidden, txt: (document.getElementById('chat-lock') || {}).innerText || '' }));
      ok('grátis: assistente bloqueado (Assinatura R$ 9,90/mês, sem campo de pergunta)', c.lock && !c.form && /faz parte da Assinatura \(R\$ 9,90\/mês\)/.test(c.txt) && /Ver planos/.test(c.txt), c);
      const st = await page.evaluate(async () => (await fetch(CMV.API_BASE + '/chat', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'oi' }], uf: 'se' }) })).status);
      ok('grátis: POST /chat → 402', st === 402, st);
      await page.evaluate(() => document.getElementById('chat-close').click());
    }
    // conta
    await page.evaluate(() => { location.hash = '#conta'; });
    await page.waitForSelector('#view-conta.active .cmv-conta');
    const ct = await page.textContent('#view-conta');
    ok('grátis: Minha conta mostra plano Gratuito e 2 de 2', /Seu plano: Gratuito/.test(ct) && /2 de 2/.test(ct), ct.slice(0, 300));
    await page.screenshot({ path: OUT + '/gratis-conta.png', fullPage: true });
    ok('grátis: sem erros de JavaScript', log.erros.length === 0, log.erros);
    await ctx.close();
  }

  /* ======================= USUÁRIO PAGO (cortesia manual) ======================= */
  {
    const { ctx, page, log } = await novaPagina(browser);
    await page.goto(SITE + '#planos', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#cmv-entrar');
    const planos = await page.textContent('#view-planos');
    ok('Planos: Gratuito × Assinatura R$ 9,90 × Campanha sob consulta', /R\$ 9,90/.test(planos) && !/49,90/.test(planos) && /Sob consulta/.test(planos) && /2 relatórios em PDF por mês/.test(planos));
    await page.screenshot({ path: OUT + '/planos.png', fullPage: true });
    const emailP = `pago-${RUN}@teste.local`;
    await cadastrar(page, 'Carlos Assinante', emailP);
    const me0 = await page.evaluate(() => CMV.me());
    // concessão manual (admin, Bearer) — é assim que o “pago” existe antes da Stripe
    const g = await fetch(`${API}/admin/usuarios/${me0.usuario.id}/cortesia`, { method: 'POST', headers: { Authorization: 'Bearer ' + ADMIN_TOKEN, 'Content-Type': 'application/json', Origin: 'http://localhost:8080' }, body: JSON.stringify({ dias: 30, motivo: 'e2e' }) });
    ok('admin concede acesso pago (cortesia 30 dias)', g.status === 200);
    await page.evaluate(() => CMV.refresh());
    await page.waitForFunction(() => /Assinante/.test(document.getElementById('cmv-entrar').textContent));
    ok('pago: cabeçalho com selo “Assinante”', true);

    await irMapa(page, '#mapa?uf=se&c=3&a=55');
    const h3 = await page.textContent('#mapa-root h3');
    ok('pago: mapa completo município → zona → bairro → colégio → seção', /município → zona → bairro/.test(h3), h3);
    const first = page.locator('#mapa-root .mapa-tree > details').first();
    await first.locator('summary').click(); await page.waitForTimeout(300);
    const z = first.locator('.mv-nested > div > details').first();
    await z.locator('summary').first().click(); await page.waitForTimeout(300);
    const b = z.locator('.mv-nested details').first();
    await b.locator('summary').first().click(); await page.waitForTimeout(300);
    const l = b.locator('.mv-nested details').first();
    await l.locator('summary').first().click();
    await page.waitForSelector('#mapa-root table.mv-sec-table', { timeout: 15000 }).catch(() => {});
    const txt = await first.innerText();
    ok('pago: abre zona → bairro → local → tabela de seções', /Zona \d+/.test(txt) && /Bairro:/.test(txt) && (await page.locator('#mapa-root table.mv-sec-table').count()) > 0, txt.slice(0, 300));
    await page.screenshot({ path: OUT + '/pago-mapa-se.png' });
    ok('pago: arquivos de detalhe vieram da API com 200', log.dados.length >= 3 && log.dados.every(d => d[1] === 200 || d[1] === 304), log.dados.slice(0, 6));
    ok('pago: nada de detalhe pedido ao bucket público', log.privadoPublico.length === 0, log.privadoPublico);
    await irMapa(page, '#mapa?uf=df&c=3&a=11');
    const dfFirst = page.locator('#mapa-root .mapa-tree > details').first();
    await dfFirst.locator('summary').click(); await page.waitForTimeout(400);
    ok('pago: DF zona → bairros', /Bairro:/.test(await dfFirst.innerText()));
    await irMapa(page, '#mapa?uf=al&c=3&a=15');
    const alFirst = page.locator('#mapa-root .mapa-tree > details').first();
    await alFirst.locator('summary').click(); await page.waitForTimeout(400);
    ok('pago: AL município → zonas', /Zona \d+/.test(await alFirst.innerText()));

    await irRelatorio(page, '#relatorios?uf=se&t=candidato&c=3&n=10');
    { const r = await previa(page); ok('pago: prévia mantém o PDF embutido (comportamento do assinante)', r.pdf && !r.soTela, r); }
    const pdf = await baixar(page, '#rel-pdf-btn', 'pago-candidato-10.pdf');
    const t = pdfText(pdf);
    ok('pago: PDF com “Licenciado para Carlos Assinante”, sem marca de versão gratuita', /Licenciado para Carlos Assinante/.test(t) && !/versão gratuita/i.test(t), t.slice(0, 200));
    ok('pago: PDF com zonas, bairros e conferência das seções', /Zona \d+ —/.test(t) && /Bairro:/.test(t) && /Conferência: soma das/.test(t));
    const xl = await baixar(page, '#rel-xlsx-btn', 'pago-candidato-10.xlsx');
    const abas = execFileSync('python3', ['-c', `import openpyxl,sys;wb=openpyxl.load_workbook(sys.argv[1],read_only=True);print('|'.join(wb.sheetnames));print(wb['Seções'].max_row if 'Seções' in wb.sheetnames else 0)`, xl]).toString().trim().split('\n');
    ok('pago: Excel com abas Info/Municípios/Locais/Seções', abas[0] === 'Info|Municípios|Locais de votação|Seções' && Number(abas[1]) > 100, abas);
    const me = await page.evaluate(() => CMV.refresh());
    ok('pago: PDF + Excel do mesmo relatório contam 1 (de 50)', me.relatorios.usados === 1 && me.relatorios.limite === 50, me.relatorios);
    await page.evaluate(() => { const b = document.querySelector('#chat-fab, .chat-fab, [data-chat-open]'); if (b) b.click(); });
    await page.waitForTimeout(400);
    const chatInput = page.locator('#chat-input, .chat-input textarea, .chat-form textarea, .chat-form input').first();
    if (await chatInput.count()) {
      await chatInput.fill('Quantos votos o Fábio 55 teve por bairro em Aracaju?');
      await page.click('#chat-send');
      await page.waitForFunction(() => /\[mock\]/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
      const bt = await page.evaluate(() => document.body.innerText);
      ok('pago: assistente com detalhe por bairro (plano Assinatura)', /\[mock\] plano=assinatura restrito=false detalhe=true/.test(bt), (bt.match(/\[mock\][^\n]*/) || [''])[0]);
    }
    await page.evaluate(() => { location.hash = '#conta'; });
    await page.waitForSelector('#view-conta.active .cmv-conta');
    const ct = await page.textContent('#view-conta');
    ok('pago: Minha conta mostra Assinatura (cortesia)', /Assinatura \(cortesia até/.test(ct) && /1 de 50/.test(ct));
    const exp = await baixar(page, '#view-conta [data-exportar]', 'pago-meus-dados.json');
    const j = JSON.parse(fs.readFileSync(exp, 'utf8'));
    ok('pago: “Baixar meus dados” (LGPD) traz e-mail e relatórios', j.usuario.email === emailP && j.relatorios.length === 1);
    await page.screenshot({ path: OUT + '/pago-conta.png', fullPage: true });
    await page.click('#view-conta [data-sair]');
    await page.waitForFunction(() => document.getElementById('cmv-entrar').textContent.trim() === 'Entrar');
    await irMapa(page, '#mapa?uf=se&c=3&a=55');
    ok('após sair: mapa volta ao nível municipal', /por município/.test(await page.textContent('#mapa-root h3')));
    ok('pago: sem erros de JavaScript', log.erros.length === 0, log.erros);
    await ctx.close();
  }
  await browser.close();
  res.total = res.checks.length; res.falhas = fails;
  fs.writeFileSync(OUT + '/e2e-results.json', JSON.stringify(res, null, 1));
  console.log(`\n${res.total - fails}/${res.total} verificações OK`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
