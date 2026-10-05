/* Relatórios PDF — client-side (jsPDF + autotable). Globals: estado, CONFIG, HIST, MAPA_INDEX, fmtInt, fmtPct, chaveDe, getJSON, setView */
(function (global) {
  'use strict';

  const CARGO_NOME = { 1: 'Presidente', 3: 'Governador', 5: 'Senador', 6: 'Dep. Federal', 7: 'Dep. Estadual' };
  const BLOCKS = [
    { id: 'gov', label: 'Governador' },
    { id: 'sen', label: 'Senado' },
    { id: 'pres', label: 'Presidente (SE)' },
    { id: 'fed', label: 'Dep. Federal' },
    { id: 'est', label: 'Dep. Estadual' },
    { id: 'eleitos', label: 'Eleitos' },
    { id: 'alese', label: 'Cadeiras Alese / Senado' },
    { id: 'hist', label: 'Histórico 2022/2018' },
    { id: 'meta', label: 'Meta do Senado' },
    { id: 'mun', label: 'Votos por município' },
    { id: 'bairro', label: 'Bairros / colégios (top)' },
  ];

  let fontCache = null;

  function JsPDFCtor() {
    const w = global.jspdf || global.jsPDF;
    if (!w) throw new Error('jsPDF não carregou');
    return w.jsPDF || w;
  }

  async function loadFontBytes(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('fonte ' + url);
    const bytes = new Uint8Array(await r.arrayBuffer());
    let s = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(s);
  }

  async function ensureFonts(doc) {
    if (!fontCache) {
      fontCache = {
        regular: await loadFontBytes('vendor/NotoSans-Regular.ttf'),
        bold: await loadFontBytes('vendor/NotoSans-Bold.ttf'),
      };
    }
    doc.addFileToVFS('NotoSans-Regular.ttf', fontCache.regular);
    doc.addFileToVFS('NotoSans-Bold.ttf', fontCache.bold);
    doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal');
    doc.addFont('NotoSans-Bold.ttf', 'NotoSans', 'bold');
    doc.setFont('NotoSans', 'normal');
  }

  function nowMaceio() {
    try {
      return new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Maceio', dateStyle: 'short', timeStyle: 'medium',
      }).format(new Date()) + ' (America/Maceio)';
    } catch {
      return new Date().toLocaleString('pt-BR');
    }
  }

  function fmtN(n) {
    const v = Number(n) || 0;
    try { return (global.fmtInt || new Intl.NumberFormat('pt-BR')).format(v); }
    catch { return String(v); }
  }

  function fmtP(n) {
    if (!Number.isFinite(Number(n))) return '—';
    try { return global.fmtPct ? global.fmtPct(n) : (Number(n).toFixed(2).replace('.', ',') + '%'); }
    catch { return String(n); }
  }

  function cargoDados(codigo, uf) {
    const cargos = (global.CONFIG && global.CONFIG.cargos) || [];
    let cargo;
    if (codigo === 1) cargo = cargos.find(c => c.codigo === 1 && c.uf === (uf || 'se')) || cargos.find(c => c.codigo === 1);
    else cargo = cargos.find(c => c.codigo === codigo && (!c.uf || c.uf === 'se'));
    const key = global.chaveDe ? global.chaveDe(cargo || { codigo }) : ((cargo && cargo.chave) || codigo);
    const st = (global.estado && global.estado[key]) || {};
    return { cargo, dados: st.dados || null };
  }

  function histOf(codigo, numero) {
    const H = global.HIST;
    if (!H || !H.historico) return null;
    return H.historico[codigo + ':' + numero + ':se'] || null;
  }

  function histLine(h) {
    if (!h) return '';
    return h.ano + ': ' + fmtN(h.votos) + ' votos (' + h.cargo + (h.partido ? ' · ' + h.partido : '') + (h.sit ? ' · ' + h.sit : '') + ')';
  }

  function trackedSet(codigo) {
    const c = ((global.CONFIG && global.CONFIG.cargos) || []).find(x => x.codigo === codigo && (!x.uf || x.uf === 'se'));
    return new Set(((c && c.candidatos) || []).map(x => String(x.numero)));
  }

  function sortedTodos(dados) {
    if (!dados || !dados.todos) return [];
    return [...dados.todos].sort((a, b) => (b.vap || 0) - (a.vap || 0) || String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
  }

  function candRows(codigo, opts) {
    const { dados } = cargoDados(codigo, codigo === 1 ? 'se' : undefined);
    const track = trackedSet(codigo);
    let list = sortedTodos(dados);
    const topN = opts && opts.topN ? opts.topN : 0;
    if (topN > 0) list = list.slice(0, topN);
    return list.map((k, i) => ({
      pos: i + 1, n: String(k.n), nome: k.nome || '', partido: k.partido || '',
      vap: k.vap || 0, pvap: k.pvap || 0,
      eleito: !!(k.eleito || /eleito/i.test(k.st || '')), st: k.st || '',
      star: track.has(String(k.n)), hist: histOf(codigo, k.n),
    }));
  }

  async function loadMapaCand(cargo, numero) {
    try { return await global.getJSON('mapa/' + cargo + '/' + numero + '.json'); }
    catch { return null; }
  }
  async function loadGeo() {
    try {
      if (global.__REL_GEO) return global.__REL_GEO;
      global.__REL_GEO = await global.getJSON('mapa/geo-se.json');
      return global.__REL_GEO;
    } catch { return null; }
  }
  async function loadMunIndex() {
    try {
      if (global.__REL_MUNIDX) return global.__REL_MUNIDX;
      global.__REL_MUNIDX = await global.getJSON('mapa/mun-index.json');
      return global.__REL_MUNIDX;
    } catch { return { muns: [] }; }
  }
  async function loadMun(cd) {
    try { return await global.getJSON('mapa/mun/' + cd + '.json'); }
    catch { return null; }
  }

  function aggregateByMun(geo, cand) {
    const locs = (geo && geo.loc) || [];
    const by = new Map();
    for (const pair of cand.v || []) {
      const L = locs[pair[0]]; const v = pair[1] || 0;
      if (!L || !v) continue;
      const cur = by.get(L.m) || { i: L.m, v: 0 };
      cur.v += v; by.set(L.m, cur);
    }
    return [...by.values()].sort((a, b) => b.v - a.v);
  }

  function aggregateInMun(geo, cand, munIdx, mode) {
    const locs = (geo && geo.loc) || [];
    const by = new Map(); let total = 0;
    for (const pair of cand.v || []) {
      const L = locs[pair[0]]; const v = pair[1] || 0;
      if (!L || L.m !== munIdx || !v) continue;
      total += v;
      let k = mode === 'zona' ? ('Zona ' + L.z)
        : mode === 'local' ? ((L.nm || ('Local ' + L.nl)) + (L.nl ? ' (#' + L.nl + ')' : ''))
        : (L.b || 'Sem bairro');
      by.set(k, (by.get(k) || 0) + v);
    }
    return { total, top: [...by.entries()].map(([nm, v]) => ({ nm, v })).sort((a, b) => b.v - a.v) };
  }

  function newDoc(opts) {
    const C = JsPDFCtor();
    return new C({ orientation: (opts && opts.landscape) ? 'landscape' : 'portrait', unit: 'pt', format: 'a4', compress: true });
  }
  function pageSize(doc) { const s = doc.internal.pageSize; return { w: s.getWidth(), h: s.getHeight() }; }
  function margins() { return { l: 40, r: 40, t: 48, b: 48 }; }

  function addFooterAll(doc, meta) {
    const n = doc.internal.getNumberOfPages();
    const { w, h } = pageSize(doc);
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      doc.setFont('NotoSans', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100);
      doc.text('Fonte: TSE — resultados oficiais 2026', 40, h - 22);
      doc.text('p. ' + i + ' de ' + n, w - 40, h - 22, { align: 'right' });
      if (meta && meta.subtitle && i > 1) {
        doc.setFontSize(7);
        doc.text(String(meta.subtitle).slice(0, 90), 40, 28);
      }
    }
    doc.setTextColor(0);
  }

  function addBookmark(doc, title, page) {
    try { if (doc.outline && doc.outline.add) doc.outline.add(null, title, { pageNumber: page }); } catch (e) {}
  }

  function sectionTitle(doc, title, y, bookmarks) {
    const m = margins();
    const { w, h } = pageSize(doc);
    if (y > h - 80) { doc.addPage(); y = m.t; }
    const page = doc.internal.getCurrentPageInfo().pageNumber;
    doc.setFont('NotoSans', 'bold'); doc.setFontSize(13); doc.setTextColor(20, 40, 80);
    doc.text(title, m.l, y);
    doc.setDrawColor(56, 189, 248); doc.setLineWidth(1);
    doc.line(m.l, y + 4, w - m.r, y + 4);
    doc.setTextColor(0);
    if (bookmarks) bookmarks.push({ title, page });
    addBookmark(doc, title, page);
    return y + 22;
  }

  function bodyText(doc, text, y) {
    const m = margins();
    const { w, h } = pageSize(doc);
    doc.setFont('NotoSans', 'normal'); doc.setFontSize(10);
    const lines = doc.splitTextToSize(String(text || ''), w - m.l - m.r);
    for (const line of lines) {
      if (y > h - m.b) { doc.addPage(); y = m.t; }
      doc.text(line, m.l, y); y += 13;
    }
    return y + 4;
  }

  function autoTable(doc, opts) {
    if (typeof doc.autoTable !== 'function') throw new Error('jspdf-autotable não carregou');
    doc.autoTable(opts);
    return doc.lastAutoTable.finalY;
  }

  function writeCover(doc, title, scope, notes) {
    const { w, h } = pageSize(doc); const m = margins();
    doc.setFont('NotoSans', 'bold'); doc.setFontSize(22); doc.setTextColor(15, 23, 42);
    doc.text('Apuração Sergipe 2026', m.l, 100);
    doc.setFontSize(16); doc.setTextColor(30, 64, 120);
    const lines = doc.splitTextToSize(title, w - m.l - m.r);
    doc.text(lines, m.l, 140);
    doc.setFont('NotoSans', 'normal'); doc.setFontSize(11); doc.setTextColor(50);
    const base = 140 + lines.length * 20;
    doc.text('Escopo: ' + scope, m.l, base + 16);
    doc.text('Gerado em: ' + nowMaceio(), m.l, base + 34);
    doc.setFontSize(9); doc.setTextColor(90);
    doc.text(doc.splitTextToSize(notes || 'Números oficiais do TSE. PDF gerado no navegador (sem armazenamento no servidor).', w - m.l - m.r), m.l, h - 100);
    doc.setTextColor(0);
  }

  function writeToc(doc, bookmarks, tocPage) {
    doc.setPage(tocPage);
    const m = margins(); const { w } = pageSize(doc);
    let y = m.t;
    doc.setFont('NotoSans', 'bold'); doc.setFontSize(14); doc.text('Sumário', m.l, y); y += 24;
    doc.setFont('NotoSans', 'normal'); doc.setFontSize(11);
    for (const b of bookmarks) {
      doc.setTextColor(20, 60, 120); doc.text(b.title, m.l, y);
      doc.setTextColor(80); doc.text(String(b.page), w - m.r, y, { align: 'right' });
      try { doc.link(m.l, y - 10, w - m.l - m.r, 14, { pageNumber: b.page }); } catch (e) {}
      y += 18;
    }
    doc.setTextColor(0);
    addBookmark(doc, 'Sumário', tocPage);
  }

  function tableCands(doc, y, rows, opts) {
    const m = margins();
    const showHist = opts && opts.hist;
    const head = [['#', 'Nº', 'Nome', 'Partido', 'Votos', '%', 'Sit.']];
    if (showHist) head[0].push('Histórico');
    const body = rows.map(r => {
      const nome = (r.star ? '★ ' : '') + (r.eleito ? '✓ ' : '') + r.nome;
      const row = [String(r.pos), r.n, nome, r.partido, fmtN(r.vap), fmtP(r.pvap), r.eleito ? 'Eleito' : (r.st || '—')];
      if (showHist) row.push(histLine(r.hist) || '—');
      return row;
    });
    return autoTable(doc, {
      startY: y, head, body,
      styles: { font: 'NotoSans', fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
      headStyles: { fillColor: [30, 64, 120], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [241, 245, 249] },
      margin: { left: m.l, right: m.r },
    }) + 12;
  }

  async function buildResumo(spec) {
    const opts = Object.assign({ landscape: false, hist: true, topN: 0 }, spec.options || {});
    const doc = newDoc(opts);
    await ensureFonts(doc);
    const title = 'Resumo da eleição — Sergipe';
    writeCover(doc, title, 'Estado de Sergipe (SE)', 'Fotos omitidas no PDF (CORS do CDN do TSE / opção padrão).');
    doc.addPage(); const tocPage = doc.internal.getCurrentPageInfo().pageNumber;
    const bookmarks = []; doc.addPage(); let y = margins().t;
    const blocks = spec.blocks || ['gov', 'sen', 'pres', 'fed', 'est', 'eleitos', 'alese'];
    if (blocks.includes('gov')) { y = sectionTitle(doc, 'Governador', y, bookmarks); y = tableCands(doc, y, candRows(3, opts), opts); }
    if (blocks.includes('sen')) { y = sectionTitle(doc, 'Senado', y, bookmarks); y = tableCands(doc, y, candRows(5, opts), opts); }
    if (blocks.includes('pres')) { y = sectionTitle(doc, 'Presidente em Sergipe', y, bookmarks); y = tableCands(doc, y, candRows(1, opts), opts); }
    if (blocks.includes('fed')) { y = sectionTitle(doc, 'Deputado Federal (top)', y, bookmarks); y = tableCands(doc, y, candRows(6, Object.assign({}, opts, { topN: opts.topN || 8 })), opts); }
    if (blocks.includes('est')) { y = sectionTitle(doc, 'Deputado Estadual (top)', y, bookmarks); y = tableCands(doc, y, candRows(7, Object.assign({}, opts, { topN: opts.topN || 24 })), opts); }
    if (blocks.includes('eleitos')) {
      y = sectionTitle(doc, 'Eleitos', y, bookmarks);
      const parts = [];
      for (const cod of [3, 5, 6, 7]) {
        const elis = candRows(cod, {}).filter(r => r.eleito);
        if (elis.length) parts.push((CARGO_NOME[cod] || cod) + ': ' + elis.map(r => r.nome + ' (' + r.n + ')').join('; '));
      }
      y = bodyText(doc, parts.join('\n') || 'Sem eleitos marcados ainda no TSE.', y);
    }
    if (blocks.includes('alese')) {
      y = sectionTitle(doc, 'Cadeiras Alese / Senado', y, bookmarks);
      const { dados } = cargoDados(7);
      if (dados && dados.listasVagas && dados.listasVagas.length) {
        const body = [...dados.listasVagas].sort((a, b) => b.vag - a.vag || b.votos - a.votos)
          .map(l => [l.nome, String(l.vag || 0), fmtN(l.votos || 0)]);
        y = autoTable(doc, { startY: y, head: [['Lista / Federação', 'Cadeiras', 'Votos']], body, styles: { font: 'NotoSans', fontSize: 9 }, headStyles: { fillColor: [30, 64, 120], textColor: 255 }, margin: { left: margins().l, right: margins().r } }) + 12;
      } else y = bodyText(doc, 'Cadeiras da Alese ainda não disponíveis no TSE.', y);
      const sen = cargoDados(5).dados;
      if (sen) {
        const elis = sortedTodos(sen).filter(k => k.eleito || /eleito/i.test(k.st || ''));
        y = bodyText(doc, 'Senado (eleitos): ' + (elis.map(k => k.nome + ' (' + k.n + ')').join('; ') || '—'), y);
      }
    }
    if (blocks.includes('meta') && global.META_SENADO) {
      y = sectionTitle(doc, 'Meta do Senado', y, bookmarks);
      y = autoTable(doc, { startY: y, head: [['Região', 'Votos 2018', 'Meta']], body: global.META_SENADO.map(r => [r.regiao, fmtN(r.v2018), fmtN(r.meta)]), styles: { font: 'NotoSans', fontSize: 8 }, headStyles: { fillColor: [30, 64, 120], textColor: 255 }, margin: { left: margins().l, right: margins().r } }) + 10;
    }
    writeToc(doc, bookmarks, tocPage);
    addFooterAll(doc, { subtitle: title });
    return doc;
  }

  async function buildCandidato(spec) {
    const opts = Object.assign({ landscape: false, hist: true, topMun: 15, detalhe: 'bairro' }, spec.options || {});
    const cargo = String(spec.cargo || spec.c || '7');
    const numero = String(spec.numero || spec.n || '');
    const list = ((global.MAPA_INDEX || {}).cargos || {})[cargo] || [];
    const meta = list.find(c => String(c.n) === numero) || {};
    const nome = meta.nu || meta.nm || spec.nome || ('Candidato ' + numero);
    const doc = newDoc(opts); await ensureFonts(doc);
    const title = 'Relatório do candidato — ' + nome;
    const scope = (CARGO_NOME[cargo] || ('Cargo ' + cargo)) + ' · nº ' + numero + (meta.sg ? ' · ' + meta.sg : '');
    writeCover(doc, title, scope, 'Fotos omitidas no PDF (CORS do CDN do TSE).');
    doc.addPage(); const tocPage = doc.internal.getCurrentPageInfo().pageNumber;
    const bookmarks = []; doc.addPage(); let y = margins().t;

    y = sectionTitle(doc, 'Totais no estado', y, bookmarks);
    const { dados } = cargoDados(Number(cargo), Number(cargo) === 1 ? 'se' : undefined);
    const all = sortedTodos(dados);
    const me = all.find(k => String(k.n) === numero);
    const rank = me ? all.findIndex(k => String(k.n) === numero) + 1 : null;
    y = bodyText(doc, [
      'Nome: ' + nome + (meta.nm && meta.nu && meta.nm !== meta.nu ? ' (' + meta.nm + ')' : ''),
      'Partido: ' + (meta.sg || (me && me.partido) || '—'),
      'Votos totais (SE): ' + (me ? fmtN(me.vap) : fmtN(meta.t)),
      '% dos válidos: ' + (me ? fmtP(me.pvap) : '—'),
      'Ranking: ' + (rank ? (rank + 'º de ' + all.length) : '—'),
      'Situação: ' + ((me && (me.eleito ? 'Eleito' : me.st)) || '—'),
    ].join('\n'), y);

    if (opts.hist !== false) {
      y = sectionTitle(doc, 'Histórico 2018/2022', y, bookmarks);
      const h = histOf(Number(cargo), numero);
      y = bodyText(doc, h ? histLine(h) : 'Sem histórico correspondente no arquivo do painel.', y);
    }

    y = sectionTitle(doc, 'Votos por município', y, bookmarks);
    const geo = await loadGeo();
    const cand = await loadMapaCand(cargo, numero);
    const munIdx = await loadMunIndex();
    const munName = new Map((munIdx.muns || []).map(m => [m.i, m.nm]));
    if (cand && geo) {
      const byMun = aggregateByMun(geo, cand).slice(0, opts.topMun || opts.topN || 15);
      y = autoTable(doc, { startY: y, head: [['#', 'Município', 'Votos']], body: byMun.map((r, i) => [String(i + 1), munName.get(r.i) || String(r.i), fmtN(r.v)]), styles: { font: 'NotoSans', fontSize: 9 }, headStyles: { fillColor: [30, 64, 120], textColor: 255 }, margin: { left: margins().l, right: margins().r } }) + 12;
      if (opts.detalhe) {
        const mode = (opts.detalhe === 'colegio' || opts.detalhe === 'local') ? 'local' : (opts.detalhe === 'zona' ? 'zona' : 'bairro');
        for (const bm of byMun.slice(0, 3)) {
          const nm = munName.get(bm.i) || String(bm.i);
          y = sectionTitle(doc, 'Detalhe (' + mode + ') — ' + nm, y, bookmarks);
          const agg = aggregateInMun(geo, cand, bm.i, mode);
          y = bodyText(doc, 'Total no município: ' + fmtN(agg.total), y);
          y = autoTable(doc, { startY: y, head: [['#', mode === 'local' ? 'Colégio / local' : (mode === 'zona' ? 'Zona' : 'Bairro'), 'Votos']], body: agg.top.slice(0, 20).map((t, i) => [String(i + 1), t.nm, fmtN(t.v)]), styles: { font: 'NotoSans', fontSize: 8 }, headStyles: { fillColor: [30, 64, 120], textColor: 255 }, margin: { left: margins().l, right: margins().r } }) + 10;
        }
      }
    } else y = bodyText(doc, 'Arquivo de mapa do candidato indisponível.', y);

    writeToc(doc, bookmarks, tocPage);
    addFooterAll(doc, { subtitle: title });
    return doc;
  }

  async function buildMunicipio(spec) {
    const opts = Object.assign({ landscape: false, topN: 10 }, spec.options || {});
    const munIdx = await loadMunIndex();
    let mun = null;
    if (spec.cd) mun = (munIdx.muns || []).find(m => String(m.cd) === String(spec.cd));
    if (!mun && spec.mun) {
      const key = String(spec.mun).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
      mun = (munIdx.muns || []).find(m => (m.key || '').includes(key) || key.includes(m.key || ''));
    }
    const doc = newDoc(opts); await ensureFonts(doc);
    const title = 'Relatório do município — ' + ((mun && mun.nm) || '—');
    writeCover(doc, title, mun ? (mun.nm + ' (CD ' + mun.cd + ')') : 'Município não resolvido', null);
    doc.addPage(); const tocPage = doc.internal.getCurrentPageInfo().pageNumber;
    const bookmarks = []; doc.addPage(); let y = margins().t;
    if (!mun) {
      y = bodyText(doc, 'Município não encontrado.', y);
    } else {
      const munData = await loadMun(mun.cd);
      y = sectionTitle(doc, 'Resumo por cargo', y, bookmarks);
      if (!munData) y = bodyText(doc, 'Arquivo municipal indisponível.', y);
      else {
        for (const cg of ['3', '5', '1', '6', '7']) {
          const rows = (munData.cargos && munData.cargos[cg]) || [];
          if (!rows.length) continue;
          y = sectionTitle(doc, CARGO_NOME[cg] || cg, y, bookmarks);
          y = autoTable(doc, { startY: y, head: [['#', 'Nº', 'Nome', 'Partido', 'Votos no mun.', 'Total SE']], body: rows.slice(0, opts.topN || 10).map((r, i) => [String(i + 1), String(r.n), r.nm || '', r.sg || '', fmtN(r.v), fmtN(r.t)]), styles: { font: 'NotoSans', fontSize: 8 }, headStyles: { fillColor: [30, 64, 120], textColor: 255 }, margin: { left: margins().l, right: margins().r } }) + 10;
        }
      }
    }
    writeToc(doc, bookmarks, tocPage);
    addFooterAll(doc, { subtitle: title });
    return doc;
  }

  async function generate(spec) {
    const t = (spec && spec.template) || 'resumo';
    if (t === 'candidato') return buildCandidato(spec);
    if (t === 'municipio' || t === 'mun') return buildMunicipio(spec);
    if (t === 'custom') {
      if (spec.scope === 'candidato' || (spec.cargo && spec.numero)) return buildCandidato(spec);
      if (spec.scope === 'municipio' || spec.cd || spec.mun) return buildMunicipio(spec);
      return buildResumo(spec);
    }
    return buildResumo(spec);
  }

  function safeFilename(s) {
    return String(s || 'relatorio').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/_+/g, '_').slice(0, 80);
  }

  function downloadDoc(doc, filename) { doc.save(filename || 'relatorio-se-2026.pdf'); }

  async function generateAndDownload(spec) {
    const doc = await generate(spec);
    const fname = safeFilename('relatorio_' + (spec.template || 'resumo') + '_' + (spec.numero || spec.cd || 'se')) + '.pdf';
    downloadDoc(doc, fname);
    return { doc, filename: fname };
  }

  function parseRelHash() {
    const raw = (location.hash || '').replace(/^#/, '');
    if (!raw.startsWith('relatorios')) return null;
    const q = raw.indexOf('?');
    const p = new URLSearchParams(q >= 0 ? raw.slice(q + 1) : '');
    const out = { template: p.get('t') || 'resumo' };
    if (p.get('c')) out.cargo = p.get('c');
    if (p.get('n')) out.numero = p.get('n');
    if (p.get('cd')) out.cd = p.get('cd');
    if (p.get('mun')) out.mun = p.get('mun');
    return out;
  }

  function buildRelHash(spec) {
    const p = new URLSearchParams();
    if (spec.template) p.set('t', spec.template === 'mun' ? 'municipio' : spec.template);
    if (spec.cargo) p.set('c', String(spec.cargo));
    if (spec.numero) p.set('n', String(spec.numero));
    if (spec.cd) p.set('cd', String(spec.cd));
    if (spec.mun) p.set('mun', String(spec.mun));
    const qs = p.toString();
    return '#relatorios' + (qs ? '?' + qs : '');
  }

  function openInPanel(spec) {
    try { history.pushState(null, '', buildRelHash(spec)); } catch (e) { location.hash = buildRelHash(spec); }
    if (typeof global.setView === 'function') global.setView('relatorios', false);
    const root = document.getElementById('grid-relatorios');
    if (root) { bootUI(); applySpecToUI(root, spec); }
  }

  function collectUISpec(root) {
    const mode = (root.querySelector('input[name=rel-mode]:checked') || {}).value || 'resumo';
    const landscape = !!root.querySelector('#rel-landscape')?.checked;
    const hist = !!root.querySelector('#rel-hist')?.checked;
    const topN = Number(root.querySelector('#rel-topn')?.value || 15);
    const detalhe = root.querySelector('#rel-detalhe')?.value || 'bairro';
    const blocks = [...root.querySelectorAll('.rel-block:checked')].map(x => x.value);
    const spec = { template: mode, options: { landscape, hist, topN, topMun: topN, detalhe: detalhe || null, fotos: false }, blocks };
    const candVal = (mode === 'custom' ? root.querySelector('#rel-cand-custom') : root.querySelector('#rel-cand'))?.value;
    const munVal = (mode === 'custom' ? root.querySelector('#rel-mun-custom') : root.querySelector('#rel-mun'))?.value;
    if (candVal) { const [c, n] = candVal.split(':'); spec.cargo = c; spec.numero = n; if (mode === 'custom') spec.scope = 'candidato'; }
    if (munVal) { spec.cd = munVal; if (mode === 'custom' && !candVal) spec.scope = 'municipio'; }
    if (mode === 'candidato') spec.template = 'candidato';
    if (mode === 'municipio') spec.template = 'municipio';
    return spec;
  }

  function syncModePanels(root) {
    const mode = (root.querySelector('input[name=rel-mode]:checked') || {}).value || 'resumo';
    root.querySelectorAll('.rel-mode-panel').forEach(p => { p.hidden = p.dataset.mode !== mode; });
    const blocks = root.querySelector('#rel-blocks');
    if (blocks) blocks.hidden = !(mode === 'custom' || mode === 'resumo');
  }

  function applySpecToUI(root, spec) {
    if (!root || !spec) return;
    let mode = spec.template || 'resumo';
    if (mode === 'mun') mode = 'municipio';
    const radio = root.querySelector('input[name=rel-mode][value="' + mode + '"]');
    if (radio) radio.checked = true;
    syncModePanels(root);
    if (spec.cargo && spec.numero) {
      for (const id of ['#rel-cand', '#rel-cand-custom']) {
        const el = root.querySelector(id); if (el) el.value = spec.cargo + ':' + spec.numero;
      }
    }
    if (spec.cd) {
      for (const id of ['#rel-mun', '#rel-mun-custom']) {
        const el = root.querySelector(id); if (el) el.value = String(spec.cd);
      }
    }
  }

  async function fillSelectors(root) {
    const candHtml = (() => {
      const opts = ['<option value="">Escolha o candidato…</option>'];
      for (const [cg, list] of Object.entries((global.MAPA_INDEX || {}).cargos || {})) {
        if (!['1', '3', '5', '6', '7'].includes(cg)) continue;
        const group = list.map(c => '<option value="' + cg + ':' + c.n + '">' + (c.nu || c.nm) + ' (' + c.n + ' · ' + (c.sg || '') + ')</option>').join('');
        opts.push('<optgroup label="' + (CARGO_NOME[cg] || cg) + '">' + group + '</optgroup>');
      }
      return opts.join('');
    })();
    for (const id of ['#rel-cand', '#rel-cand-custom']) {
      const el = root.querySelector(id); if (el) el.innerHTML = candHtml;
    }
    const idx = await loadMunIndex();
    const munHtml = ['<option value="">Escolha o município…</option>']
      .concat([...(idx.muns || [])].sort((a, b) => a.nm.localeCompare(b.nm, 'pt-BR')).map(m => '<option value="' + m.cd + '">' + m.nm + '</option>'))
      .join('');
    for (const id of ['#rel-mun', '#rel-mun-custom']) {
      const el = root.querySelector(id); if (el) el.innerHTML = munHtml;
    }
  }

  function bootUI() {
    const root = document.getElementById('grid-relatorios');
    if (!root) return;
    if (!root.dataset.booted) {
      root.dataset.booted = '1';
      root.innerHTML = [
        '<section class="card span-all rel-card">',
        '<h2>Relatórios (PDF)</h2>',
        '<p class="meta">PDFs gerados no navegador com dados do TSE. Sumário clicável e favoritos/outline do PDF.</p>',
        '<div class="rel-modes" role="radiogroup" aria-label="Modelo">',
        '<label><input type="radio" name="rel-mode" value="resumo" checked> Resumo da eleição</label>',
        '<label><input type="radio" name="rel-mode" value="candidato"> Relatório do candidato</label>',
        '<label><input type="radio" name="rel-mode" value="municipio"> Relatório do município</label>',
        '<label><input type="radio" name="rel-mode" value="custom"> Personalizado</label>',
        '</div>',
        '<div class="rel-mode-panel" data-mode="candidato"><label class="rel-field">Candidato <select id="rel-cand"></select></label></div>',
        '<div class="rel-mode-panel" data-mode="municipio" hidden><label class="rel-field">Município <select id="rel-mun"></select></label></div>',
        '<div class="rel-mode-panel" data-mode="custom" hidden>',
        '<label class="rel-field">Candidato (opcional) <select id="rel-cand-custom"></select></label>',
        '<label class="rel-field">Município (opcional) <select id="rel-mun-custom"></select></label>',
        '</div>',
        '<div id="rel-blocks" class="rel-blocks"><div class="meta">Blocos</div>',
        BLOCKS.map(b => '<label><input class="rel-block" type="checkbox" value="' + b.id + '"' + (['gov','sen','pres','fed','est','eleitos','alese','hist'].includes(b.id) ? ' checked' : '') + '> ' + b.label + '</label>').join(' '),
        '</div>',
        '<div class="rel-opts">',
        '<label><input type="checkbox" id="rel-landscape"> Paisagem</label>',
        '<label><input type="checkbox" id="rel-hist" checked> Histórico</label>',
        '<label>Top N <input type="number" id="rel-topn" min="3" max="75" value="15" style="width:4.5rem"></label>',
        '<label>Detalhe <select id="rel-detalhe"><option value="bairro">Bairros</option><option value="zona">Zonas</option><option value="local">Colégios</option><option value="">(sem)</option></select></label>',
        '</div>',
        '<div class="rel-actions">',
        '<button type="button" class="btn-mapa" id="rel-preview-btn">Atualizar prévia</button>',
        '<button type="button" class="btn-mapa" id="rel-pdf-btn">Gerar PDF</button>',
        '</div>',
        '<pre id="rel-preview" class="rel-preview">Escolha um modelo e gere o PDF.</pre>',
        '<p class="meta">Limitação: fotos do TSE geralmente não entram no PDF por CORS.</p>',
        '</section>'
      ].join('');
      root.querySelectorAll('input[name=rel-mode]').forEach(r => r.addEventListener('change', () => syncModePanels(root)));
      root.querySelector('#rel-preview-btn').addEventListener('click', () => {
        const spec = collectUISpec(root);
        root.querySelector('#rel-preview').textContent = 'Prévia:\n' + JSON.stringify(spec, null, 2);
        try { history.replaceState(null, '', buildRelHash(spec)); } catch (e) {}
      });
      root.querySelector('#rel-pdf-btn').addEventListener('click', async () => {
        const btn = root.querySelector('#rel-pdf-btn');
        const spec = collectUISpec(root);
        if (spec.template === 'candidato' && !spec.numero) { root.querySelector('#rel-preview').textContent = 'Selecione um candidato.'; return; }
        if (spec.template === 'municipio' && !spec.cd) { root.querySelector('#rel-preview').textContent = 'Selecione um município.'; return; }
        btn.disabled = true;
        root.querySelector('#rel-preview').textContent = 'Gerando PDF…';
        try {
          const { filename } = await generateAndDownload(spec);
          root.querySelector('#rel-preview').textContent = 'PDF gerado: ' + filename + '\n\n' + JSON.stringify(spec, null, 2);
          try { history.replaceState(null, '', buildRelHash(spec)); } catch (e) {}
        } catch (e) {
          console.error(e);
          root.querySelector('#rel-preview').textContent = 'Erro: ' + (e && e.message ? e.message : e);
        } finally { btn.disabled = false; }
      });
    }
    fillSelectors(root).then(() => {
      const hs = parseRelHash();
      if (hs) applySpecToUI(root, hs);
    });
    syncModePanels(root);
  }

  global.Relatorios = {
    generate, generateAndDownload, openInPanel, bootUI, parseRelHash, buildRelHash, applySpecToUI, BLOCKS, CARGO_NOME,
  };
})(window);
