/* Relatórios PDF + prévia web — jsPDF/autotable + mapas SE */
(function (global) {
  'use strict';

  const CARGO_NOME = { 1: 'Presidente', 3: 'Governador', 5: 'Senador', 6: 'Dep. Federal', 7: 'Dep. Estadual' };
  const BLOCKS = [
    { id: 'gov', label: 'Governador' }, { id: 'sen', label: 'Senado' },
    { id: 'pres', label: 'Presidente (SE)' }, { id: 'fed', label: 'Dep. Federal' },
    { id: 'est', label: 'Dep. Estadual' }, { id: 'eleitos', label: 'Eleitos' },
    { id: 'alese', label: 'Cadeiras Alese / Senado' }, { id: 'hist', label: 'Histórico' },
    { id: 'meta', label: 'Meta do Senado' },
  ];

  let fontCache = null;
  let geoMunCache = null;
  let geoLocCache = null;
  let munIdxCache = null;

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
    for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
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
      return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Maceio', dateStyle: 'short', timeStyle: 'medium' }).format(new Date()) + ' (America/Maceio)';
    } catch { return new Date().toLocaleString('pt-BR'); }
  }

  function fmtN(n) {
    try { return (global.fmtInt || new Intl.NumberFormat('pt-BR')).format(Number(n) || 0); }
    catch { return String(n || 0); }
  }
  function fmtP(n) {
    if (!Number.isFinite(Number(n))) return '—';
    try { return global.fmtPct ? global.fmtPct(n) : (Number(n).toFixed(2).replace('.', ',') + '%'); }
    catch { return String(n); }
  }

  function cargoDados(codigo) {
    const cargos = (global.CONFIG && global.CONFIG.cargos) || [];
    const cargo = codigo === 1
      ? (cargos.find(c => c.codigo === 1 && c.uf === 'se') || cargos.find(c => c.codigo === 1))
      : cargos.find(c => c.codigo === codigo && (!c.uf || c.uf === 'se'));
    const key = global.chaveDe ? global.chaveDe(cargo || { codigo }) : ((cargo && cargo.chave) || codigo);
    const st = (global.estado && global.estado[key]) || {};
    return { cargo, dados: st.dados || null, key };
  }

  function histOf(codigo, numero) {
    const H = global.HIST;
    if (!H || !H.historico) return null;
    return H.historico[codigo + ':' + numero + ':se'] || null;
  }
  function histLine(h) {
    if (!h) return '—';
    return h.ano + ': ' + fmtN(h.votos) + ' votos (' + h.cargo + (h.partido ? ' · ' + h.partido : '') + (h.sit ? ' · ' + h.sit : '') + ')';
  }

  function metaCand(cargo, numero) {
    const list = ((global.MAPA_INDEX || {}).cargos || {})[String(cargo)] || [];
    return list.find(c => String(c.n) === String(numero)) || { n: String(numero), nm: 'Candidato ' + numero };
  }

  function fotoPath(cargo, numero) {
    return 'fotos/' + cargo + '/' + numero + '.jpg';
  }

  async function loadImageDataUrl(path) {
    try {
      const r = await fetch(path);
      if (!r.ok) return null;
      const blob = await r.blob();
      return await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = reject;
        fr.readAsDataURL(blob);
      });
    } catch { return null; }
  }

  async function loadGeoMun() {
    if (geoMunCache) return geoMunCache;
    geoMunCache = await global.getJSON('mapa/se-mun.geojson');
    return geoMunCache;
  }
  async function loadGeoLoc() {
    if (geoLocCache) return geoLocCache;
    geoLocCache = await global.getJSON('mapa/geo-se.json');
    return geoLocCache;
  }
  async function loadMunIndex() {
    if (munIdxCache) return munIdxCache;
    munIdxCache = await global.getJSON('mapa/mun-index.json');
    return munIdxCache;
  }
  async function loadCandFile(cargo, numero) {
    try { return await global.getJSON('mapa/' + cargo + '/' + numero + '.json'); }
    catch { return null; }
  }

  function sortedTodos(dados) {
    if (!dados || !dados.todos) return [];
    return [...dados.todos].sort((a, b) => (b.vap || 0) - (a.vap || 0) || String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
  }

  function candState(cargo, numero) {
    const { dados } = cargoDados(Number(cargo));
    const all = sortedTodos(dados);
    const me = all.find(k => String(k.n) === String(numero));
    const rank = me ? all.findIndex(k => String(k.n) === String(numero)) + 1 : null;
    const meta = metaCand(cargo, numero);
    const partyList = all.filter(k => (k.partido || '') === (me && me.partido || meta.sg || ''));
    const partyRank = me ? partyList.findIndex(k => String(k.n) === String(numero)) + 1 : null;
    return {
      meta, me, rank, total: all.length, partyRank, partyTotal: partyList.length,
      vap: me ? me.vap : (meta.t || 0),
      pvap: me ? me.pvap : null,
      st: me ? (me.eleito ? 'Eleito' : (me.st || '—')) : '—',
      eleito: !!(me && me.eleito),
      hist: histOf(Number(cargo), numero),
      nome: meta.nu || meta.nm || (me && me.nome) || String(numero),
      partido: meta.sg || (me && me.partido) || '',
    };
  }

  /** Build nested tree: mun -> zona -> bairro -> escola */
  function buildVoteTree(geo, cand) {
    const locs = (geo && geo.loc) || [];
    const muns = new Map();
    let total = 0;
    for (const pair of cand.v || []) {
      const li = pair[0], v = pair[1] || 0;
      const L = locs[li];
      if (!L || !v) continue;
      total += v;
      let mun = muns.get(L.m);
      if (!mun) { mun = { i: L.m, v: 0, zonas: new Map() }; muns.set(L.m, mun); }
      mun.v += v;
      let zona = mun.zonas.get(L.z);
      if (!zona) { zona = { z: L.z, v: 0, bairros: new Map() }; mun.zonas.set(L.z, zona); }
      zona.v += v;
      const bName = L.b || 'Sem bairro';
      let bairro = zona.bairros.get(bName);
      if (!bairro) { bairro = { nm: bName, v: 0, escolas: new Map() }; zona.bairros.set(bName, bairro); }
      bairro.v += v;
      const eKey = (L.nl || '') + '|' + (L.nm || '');
      let esc = bairro.escolas.get(eKey);
      if (!esc) { esc = { nl: L.nl || '', nm: L.nm || ('Local ' + (L.nl || '')), v: 0 }; bairro.escolas.set(eKey, esc); }
      esc.v += v;
    }
    const munList = [...muns.values()].sort((a, b) => b.v - a.v);
    for (const m of munList) {
      m.zonaList = [...m.zonas.values()].sort((a, b) => b.v - a.v || a.z - b.z);
      for (const z of m.zonaList) {
        z.bairroList = [...z.bairros.values()].sort((a, b) => b.v - a.v || a.nm.localeCompare(b.nm, 'pt-BR'));
        for (const b of z.bairroList) {
          b.escolaList = [...b.escolas.values()].sort((a, b) => b.v - a.v || a.nm.localeCompare(b.nm, 'pt-BR'));
        }
      }
    }
    return { total, munList, byI: muns };
  }

  function mergeCompareTrees(treeA, treeB, munNames) {
    const ids = new Set([...treeA.byI.keys(), ...treeB.byI.keys()]);
    const rows = [];
    for (const i of ids) {
      const a = treeA.byI.get(i);
      const b = treeB.byI.get(i);
      const va = a ? a.v : 0, vb = b ? b.v : 0;
      rows.push({
        i, nm: munNames.get(i) || String(i),
        a: va, b: vb, d: va - vb,
        winner: va === vb ? 'empate' : (va > vb ? 'a' : 'b'),
        aNode: a, bNode: b,
      });
    }
    rows.sort((x, y) => Math.abs(y.d) - Math.abs(x.d) || y.a + y.b - (x.a + x.b) || x.nm.localeCompare(y.nm, 'pt-BR'));
    return rows;
  }

  /* ---------- Choropleth ---------- */
  // Sequential YlOrRd-like: least -> most
  const SEQ = ['#fff7bc', '#fee391', '#fec44f', '#fe9929', '#ec7014', '#cc4c02', '#993404', '#662506'];

  function colorScale(t) {
    const x = Math.max(0, Math.min(1, t));
    const i = Math.min(SEQ.length - 1, Math.floor(x * (SEQ.length - 1)));
    return SEQ[i];
  }

  function legendRanges(minV, maxV) {
    const ranges = [];
    for (let i = 0; i < SEQ.length; i++) {
      const a = minV + (maxV - minV) * (i / SEQ.length);
      const b = minV + (maxV - minV) * ((i + 1) / SEQ.length);
      ranges.push({ color: SEQ[i], from: Math.round(a), to: Math.round(b) });
    }
    return ranges;
  }

  function bboxOf(geojson) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    function walk(c) {
      if (typeof c[0] === 'number') {
        minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0]);
        minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1]);
      } else c.forEach(walk);
    }
    for (const f of geojson.features) walk(f.geometry.coordinates);
    return { minX, minY, maxX, maxY };
  }

  function projectFactory(bb, W, H, pad) {
    const p = pad || 8;
    const bw = bb.maxX - bb.minX || 1, bh = bb.maxY - bb.minY || 1;
    const sx = (W - 2 * p) / bw, sy = (H - 2 * p) / bh;
    const s = Math.min(sx, sy);
    const ox = p + ((W - 2 * p) - bw * s) / 2;
    const oy = p + ((H - 2 * p) - bh * s) / 2;
    return (lon, lat) => [ox + (lon - bb.minX) * s, oy + (bb.maxY - lat) * s];
  }

  function ringPath(ring, proj) {
    return ring.map((p, i) => {
      const [x, y] = proj(p[0], p[1]);
      return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }).join(' ') + 'Z';
  }

  function geomPath(g, proj) {
    if (g.type === 'Polygon') return g.coordinates.map(r => ringPath(r, proj)).join(' ');
    if (g.type === 'MultiPolygon') return g.coordinates.map(poly => poly.map(r => ringPath(r, proj)).join(' ')).join(' ');
    return '';
  }

  function buildChoroplethSVG(geojson, valueByI, opts) {
    const W = (opts && opts.w) || 560, H = (opts && opts.h) || 420;
    const title = (opts && opts.title) || '';
    const mode = (opts && opts.mode) || 'seq'; // seq | win
    const bb = bboxOf(geojson);
    const proj = projectFactory(bb, W, H - (mode === 'seq' ? 48 : 36), 10);
    let minV = Infinity, maxV = -Infinity;
    const vals = [];
    for (const f of geojson.features) {
      const i = f.properties.i;
      const v = valueByI.get(i) || 0;
      vals.push(v);
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    if (!Number.isFinite(minV)) { minV = 0; maxV = 1; }
    if (minV === maxV) maxV = minV + 1;

    let paths = '';
    for (const f of geojson.features) {
      const i = f.properties.i;
      let fill = '#e2e8f0';
      if (mode === 'win') {
        const w = valueByI.get(i); // 'a' | 'b' | 'empate' | null via side channel
        const winMap = (opts && opts.winByI) || new Map();
        const winner = winMap.get(i);
        const va = ((opts && opts.aByI) || new Map()).get(i) || 0;
        const vb = ((opts && opts.bByI) || new Map()).get(i) || 0;
        if (winner === 'a') fill = '#2563eb';
        else if (winner === 'b') fill = '#dc2626';
        else if (winner === 'empate') fill = '#94a3b8';
        else fill = '#e2e8f0';
        // fade by margin
        const tot = va + vb;
        if (tot > 0 && (winner === 'a' || winner === 'b')) {
          const margin = Math.abs(va - vb) / tot;
          const alpha = 0.35 + 0.65 * margin;
          fill = winner === 'a' ? `rgba(37,99,235,${alpha.toFixed(2)})` : `rgba(220,38,38,${alpha.toFixed(2)})`;
        }
      } else {
        const v = valueByI.get(i) || 0;
        fill = colorScale((v - minV) / (maxV - minV));
      }
      const d = geomPath(f.geometry, proj);
      const tip = (f.properties.nm || '') + ': ' + fmtN(valueByI.get(i) || 0);
      paths += `<path d="${d}" fill="${fill}" stroke="#64748b" stroke-width="0.4" data-i="${i}"><title>${tip.replace(/"/g, '')}</title></path>`;
    }

    let legend = '';
    if (mode === 'seq') {
      const ranges = legendRanges(minV, maxV);
      const lw = W - 20, lh = 14, lx = 10, ly = H - 32;
      const cw = lw / ranges.length;
      legend = `<text x="10" y="${H - 40}" font-size="10" fill="#334155">Menos votos → Mais votos</text>`;
      ranges.forEach((r, i) => {
        legend += `<rect x="${lx + i * cw}" y="${ly}" width="${cw}" height="${lh}" fill="${r.color}" stroke="#94a3b8" stroke-width="0.3"/>`;
      });
      legend += `<text x="${lx}" y="${ly + lh + 11}" font-size="9" fill="#64748b">${fmtN(minV)}</text>`;
      legend += `<text x="${lx + lw}" y="${ly + lh + 11}" font-size="9" fill="#64748b" text-anchor="end">${fmtN(maxV)}</text>`;
    } else {
      legend = `<text x="10" y="${H - 18}" font-size="10" fill="#334155">■ A vence  ■ B vence  ■ Empate</text>`;
      legend = `<rect x="10" y="${H - 30}" width="12" height="10" fill="#2563eb"/><text x="26" y="${H - 21}" font-size="10" fill="#334155">A vence</text>`
        + `<rect x="100" y="${H - 30}" width="12" height="10" fill="#dc2626"/><text x="116" y="${H - 21}" font-size="10" fill="#334155">B vence</text>`
        + `<rect x="190" y="${H - 30}" width="12" height="10" fill="#94a3b8"/><text x="206" y="${H - 21}" font-size="10" fill="#334155">Empate</text>`;
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <rect width="100%" height="100%" fill="#f8fafc"/>
      ${title ? `<text x="10" y="16" font-size="12" font-weight="700" fill="#0f172a">${title.replace(/</g, '')}</text>` : ''}
      <g transform="translate(0,${title ? 8 : 0})">${paths}</g>
      ${legend}
    </svg>`;
  }

  async function svgToPngDataUrl(svg, w, h) {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = 'sync';
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      return canvas.toDataURL('image/png');
    } finally { URL.revokeObjectURL(url); }
  }

  /* ---------- PDF helpers ---------- */
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
      doc.setFont('NotoSans', 'normal'); doc.setFontSize(8); doc.setTextColor(100);
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

  function sectionTitle(doc, title, y, bookmarks, anchorId) {
    const m = margins();
    const { w, h } = pageSize(doc);
    if (y > h - 90) { doc.addPage(); y = m.t; }
    const page = doc.internal.getCurrentPageInfo().pageNumber;
    doc.setFont('NotoSans', 'bold'); doc.setFontSize(13); doc.setTextColor(20, 40, 80);
    doc.text(title, m.l, y);
    doc.setDrawColor(56, 189, 248); doc.setLineWidth(1);
    doc.line(m.l, y + 4, w - m.r, y + 4);
    doc.setTextColor(0);
    if (bookmarks) bookmarks.push({ title, page, id: anchorId || title });
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

  async function writeCover(doc, title, scope, notes, photoUrls) {
    const { w, h } = pageSize(doc); const m = margins();
    doc.setFont('NotoSans', 'bold'); doc.setFontSize(22); doc.setTextColor(15, 23, 42);
    doc.text('Apuração Sergipe 2026', m.l, 90);
    doc.setFontSize(15); doc.setTextColor(30, 64, 120);
    const lines = doc.splitTextToSize(title, w - m.l - m.r - ((photoUrls && photoUrls.length) ? 130 : 0));
    doc.text(lines, m.l, 125);
    // photos on cover
    if (photoUrls && photoUrls.length) {
      let px = w - m.r - 110;
      for (const url of photoUrls.slice(0, 2)) {
        if (!url) continue;
        try { doc.addImage(url, 'JPEG', px, 110, 100, 100); } catch (e) {
          try { doc.addImage(url, 'PNG', px, 110, 100, 100); } catch (_) {}
        }
        px -= 110;
      }
    }
    doc.setFont('NotoSans', 'normal'); doc.setFontSize(11); doc.setTextColor(50);
    const base = 125 + lines.length * 18 + 10;
    doc.text('Escopo: ' + scope, m.l, base);
    doc.text('Gerado em: ' + nowMaceio(), m.l, base + 18);
    doc.setFontSize(9); doc.setTextColor(90);
    doc.text(doc.splitTextToSize(notes || 'Números oficiais do TSE. PDF gerado no navegador.', w - m.l - m.r), m.l, h - 90);
    doc.setTextColor(0);
  }

  function writeToc(doc, bookmarks, tocPage) {
    doc.setPage(tocPage);
    const m = margins(); const { w, h } = pageSize(doc);
    let y = m.t;
    doc.setFont('NotoSans', 'bold'); doc.setFontSize(14); doc.text('Sumário', m.l, y); y += 22;
    doc.setFont('NotoSans', 'normal'); doc.setFontSize(10);
    for (const b of bookmarks) {
      if (y > h - m.b) { doc.addPage(); y = m.t; }
      doc.setTextColor(20, 60, 120); doc.text(b.title.slice(0, 70), m.l, y);
      doc.setTextColor(80); doc.text(String(b.page), w - m.r, y, { align: 'right' });
      try { doc.link(m.l, y - 9, w - m.l - m.r, 12, { pageNumber: b.page }); } catch (e) {}
      y += 14;
    }
    doc.setTextColor(0);
    addBookmark(doc, 'Sumário', tocPage);
  }

  function backLink(doc, y, tocPage) {
    const m = margins();
    doc.setFont('NotoSans', 'normal'); doc.setFontSize(9); doc.setTextColor(30, 100, 180);
    doc.text('↑ Voltar ao sumário', m.l, y);
    try { doc.link(m.l, y - 8, 120, 12, { pageNumber: tocPage }); } catch (e) {}
    doc.setTextColor(0);
    return y + 14;
  }

  /* ---------- Report builders ---------- */
  async function buildCandidatoFull(spec) {
    const cargo = String(spec.cargo || spec.c || '7');
    const numero = String(spec.numero || spec.n || spec.a || '');
    const opts = Object.assign({ landscape: false }, spec.options || {});
    const st = candState(cargo, numero);
    const photo = await loadImageDataUrl(fotoPath(cargo, numero));
    const doc = newDoc(opts); await ensureFonts(doc);
    const title = 'Relatório completo — ' + st.nome;
    const scope = (CARGO_NOME[cargo] || cargo) + ' · nº ' + numero + (st.partido ? ' · ' + st.partido : '');
    await writeCover(doc, title, scope, 'Foto local (repositório). Detalhamento completo município → zona → bairro → escola.', photo ? [photo] : []);

    doc.addPage(); const tocPage = doc.internal.getCurrentPageInfo().pageNumber;
    const bookmarks = [];
    doc.addPage(); let y = margins().t;

    y = sectionTitle(doc, 'Resumo executivo', y, bookmarks);
    if (photo) { try { doc.addImage(photo, 'JPEG', pageSize(doc).w - margins().r - 72, y - 10, 64, 64); } catch (e) {} }
    y = bodyText(doc, [
      'Nome: ' + st.nome + (st.meta.nm && st.meta.nu && st.meta.nm !== st.meta.nu ? ' (' + st.meta.nm + ')' : ''),
      'Partido: ' + st.partido,
      'Votos (SE): ' + fmtN(st.vap) + (st.pvap != null ? ' (' + fmtP(st.pvap) + ')' : ''),
      'Ranking no cargo: ' + (st.rank ? st.rank + 'º de ' + st.total : '—'),
      'Ranking no partido: ' + (st.partyRank ? st.partyRank + 'º de ' + st.partyTotal : '—'),
      'Situação: ' + st.st,
      'Histórico: ' + histLine(st.hist),
    ].join('\n'), y);

    // Map
    y = sectionTitle(doc, 'Mapa por município (votos)', y, bookmarks);
    const geojson = await loadGeoMun();
    const geo = await loadGeoLoc();
    const cand = await loadCandFile(cargo, numero);
    const tree = buildVoteTree(geo, cand || { v: [] });
    const valueByI = new Map([...tree.byI.entries()].map(([i, n]) => [i, n.v]));
    const svg = buildChoroplethSVG(geojson, valueByI, { w: 520, h: 400, title: st.nome, mode: 'seq' });
    try {
      const png = await svgToPngDataUrl(svg, 1040, 800);
      if (y > pageSize(doc).h - 320) { doc.addPage(); y = margins().t; }
      doc.addImage(png, 'PNG', margins().l, y, 520, 400);
      y += 410;
    } catch (e) {
      y = bodyText(doc, 'Não foi possível renderizar o mapa: ' + (e.message || e), y);
    }

    const munIdx = await loadMunIndex();
    const munNames = new Map((munIdx.muns || []).map(m => [m.i, m.nm]));

    y = sectionTitle(doc, 'Índice de municípios', y, bookmarks, 'idx-mun');
    const munPageMap = new Map();
    // We'll fill pages as we go — first list with placeholder pages updated... simpler: list then detail, link forward as we create
    const munIndexStartPage = doc.internal.getCurrentPageInfo().pageNumber;
    const munIndexY = y;
    // Write compact mun table first (without forward links to unknown pages), then details with back links
    const bodyMun = tree.munList.map((m, idx) => [String(idx + 1), munNames.get(m.i) || String(m.i), fmtN(m.v)]);
    y = autoTable(doc, {
      startY: y, head: [['#', 'Município', 'Votos']], body: bodyMun,
      styles: { font: 'NotoSans', fontSize: 8 }, headStyles: { fillColor: [30, 64, 120], textColor: 255 },
      margin: { left: margins().l, right: margins().r },
    }) + 10;

    for (const m of tree.munList) {
      const nm = munNames.get(m.i) || String(m.i);
      y = sectionTitle(doc, 'Município: ' + nm + ' (' + fmtN(m.v) + ')', y, bookmarks, 'mun-' + m.i);
      munPageMap.set(m.i, doc.internal.getCurrentPageInfo().pageNumber);
      y = backLink(doc, y, tocPage);
      for (const z of m.zonaList) {
        if (y > pageSize(doc).h - 100) { doc.addPage(); y = margins().t; }
        doc.setFont('NotoSans', 'bold'); doc.setFontSize(10);
        doc.text('Zona ' + z.z + ' — ' + fmtN(z.v) + ' votos', margins().l, y); y += 12;
        for (const b of z.bairroList) {
          if (y > pageSize(doc).h - 80) { doc.addPage(); y = margins().t; }
          doc.setFont('NotoSans', 'bold'); doc.setFontSize(9); doc.setTextColor(40, 60, 90);
          doc.text('Bairro: ' + b.nm + ' (' + fmtN(b.v) + ')', margins().l + 8, y); y += 11;
          doc.setTextColor(0);
          const rows = b.escolaList.map(e => [e.nl || '—', e.nm, fmtN(e.v)]);
          y = autoTable(doc, {
            startY: y, head: [['Nº local', 'Escola / local', 'Votos']], body: rows,
            styles: { font: 'NotoSans', fontSize: 7, cellPadding: 2 },
            headStyles: { fillColor: [51, 65, 85], textColor: 255, fontSize: 7 },
            margin: { left: margins().l + 8, right: margins().r },
          }) + 6;
        }
      }
    }

    writeToc(doc, bookmarks, tocPage);
    addFooterAll(doc, { subtitle: title });
    return { doc, tree, st, svg };
  }

  async function buildComparar(spec) {
    const cargo = String(spec.cargo || spec.c || '7');
    const aN = String(spec.a || spec.numero || '');
    const bN = String(spec.b || '');
    const opts = Object.assign({ landscape: false }, spec.options || {});
    const stA = candState(cargo, aN);
    const stB = candState(cargo, bN);
    const photoA = await loadImageDataUrl(fotoPath(cargo, aN));
    const photoB = await loadImageDataUrl(fotoPath(cargo, bN));
    const doc = newDoc(opts); await ensureFonts(doc);
    const title = 'Comparativo — ' + stA.nome + ' × ' + stB.nome;
    const scope = (CARGO_NOME[cargo] || cargo) + ' · ' + aN + ' vs ' + bN;
    await writeCover(doc, title, scope, 'Comparativo zoneado completo (município → zona → bairro → escola). Fotos do repositório local.', [photoA, photoB].filter(Boolean));

    doc.addPage(); const tocPage = doc.internal.getCurrentPageInfo().pageNumber;
    const bookmarks = [];
    doc.addPage(); let y = margins().t;

    y = sectionTitle(doc, 'Resumo executivo', y, bookmarks);
    // side by side photos
    let px = margins().l;
    for (const ph of [photoA, photoB]) {
      if (!ph) continue;
      try { doc.addImage(ph, 'JPEG', px, y, 56, 56); } catch (e) {}
      px += 64;
    }
    y += 64;
    y = bodyText(doc, [
      'A: ' + stA.nome + ' (' + aN + ' · ' + stA.partido + ') — ' + fmtN(stA.vap) + ' votos' + (stA.pvap != null ? ' (' + fmtP(stA.pvap) + ')' : '') + ' · ranking ' + (stA.rank || '—') + 'º · ' + stA.st,
      '   Histórico: ' + histLine(stA.hist),
      'B: ' + stB.nome + ' (' + bN + ' · ' + stB.partido + ') — ' + fmtN(stB.vap) + ' votos' + (stB.pvap != null ? ' (' + fmtP(stB.pvap) + ')' : '') + ' · ranking ' + (stB.rank || '—') + 'º · ' + stB.st,
      '   Histórico: ' + histLine(stB.hist),
      'Diferença A−B (estado): ' + fmtN(stA.vap - stB.vap),
    ].join('\n'), y);

    const geojson = await loadGeoMun();
    const geo = await loadGeoLoc();
    const candA = await loadCandFile(cargo, aN);
    const candB = await loadCandFile(cargo, bN);
    const treeA = buildVoteTree(geo, candA || { v: [] });
    const treeB = buildVoteTree(geo, candB || { v: [] });
    const munIdx = await loadMunIndex();
    const munNames = new Map((munIdx.muns || []).map(m => [m.i, m.nm]));
    const cmpRows = mergeCompareTrees(treeA, treeB, munNames);

    const aByI = new Map([...treeA.byI.entries()].map(([i, n]) => [i, n.v]));
    const bByI = new Map([...treeB.byI.entries()].map(([i, n]) => [i, n.v]));
    const winByI = new Map(cmpRows.map(r => [r.i, r.winner]));

    y = sectionTitle(doc, 'Mapa A — ' + stA.nome, y, bookmarks);
    try {
      const svgA = buildChoroplethSVG(geojson, aByI, { w: 520, h: 390, title: 'Votos por município — A', mode: 'seq' });
      const pngA = await svgToPngDataUrl(svgA, 1040, 780);
      if (y > pageSize(doc).h - 300) { doc.addPage(); y = margins().t; }
      doc.addImage(pngA, 'PNG', margins().l, y, 520, 390); y += 400;
    } catch (e) { y = bodyText(doc, 'Mapa A indisponível: ' + e.message, y); }

    y = sectionTitle(doc, 'Mapa B — ' + stB.nome, y, bookmarks);
    try {
      const svgB = buildChoroplethSVG(geojson, bByI, { w: 520, h: 390, title: 'Votos por município — B', mode: 'seq' });
      const pngB = await svgToPngDataUrl(svgB, 1040, 780);
      if (y > pageSize(doc).h - 300) { doc.addPage(); y = margins().t; }
      doc.addImage(pngB, 'PNG', margins().l, y, 520, 390); y += 400;
    } catch (e) { y = bodyText(doc, 'Mapa B indisponível: ' + e.message, y); }

    y = sectionTitle(doc, 'Mapa comparativo (quem venceu o município)', y, bookmarks);
    try {
      const svgC = buildChoroplethSVG(geojson, aByI, { w: 520, h: 390, title: 'Vencedor por município', mode: 'win', winByI, aByI, bByI });
      const pngC = await svgToPngDataUrl(svgC, 1040, 780);
      if (y > pageSize(doc).h - 300) { doc.addPage(); y = margins().t; }
      doc.addImage(pngC, 'PNG', margins().l, y, 520, 390); y += 400;
    } catch (e) { y = bodyText(doc, 'Mapa comparativo indisponível: ' + e.message, y); }

    y = sectionTitle(doc, 'Todos os municípios (A, B, diferença)', y, bookmarks, 'idx-mun');
    y = autoTable(doc, {
      startY: y,
      head: [['Município', 'A', 'B', 'A−B', 'Vencedor']],
      body: cmpRows.map(r => [r.nm, fmtN(r.a), fmtN(r.b), fmtN(r.d), r.winner === 'a' ? 'A' : r.winner === 'b' ? 'B' : '=']),
      styles: { font: 'NotoSans', fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [30, 64, 120], textColor: 255 },
      margin: { left: margins().l, right: margins().r },
    }) + 8;

    // Full drill-down per município
    for (const r of cmpRows) {
      y = sectionTitle(doc, r.nm + ' — A ' + fmtN(r.a) + ' · B ' + fmtN(r.b) + ' · Δ ' + fmtN(r.d), y, bookmarks, 'mun-' + r.i);
      y = backLink(doc, y, tocPage);

      // union of zonas
      const zonaIds = new Set([
        ...((r.aNode && r.aNode.zonaList) || []).map(z => z.z),
        ...((r.bNode && r.bNode.zonaList) || []).map(z => z.z),
      ]);
      const zonaList = [...zonaIds].sort((a, b) => a - b);
      for (const zid of zonaList) {
        const za = r.aNode && r.aNode.zonas.get(zid);
        const zb = r.bNode && r.bNode.zonas.get(zid);
        const zvA = za ? za.v : 0, zvB = zb ? zb.v : 0;
        if (y > pageSize(doc).h - 90) { doc.addPage(); y = margins().t; }
        doc.setFont('NotoSans', 'bold'); doc.setFontSize(10);
        doc.text('Zona ' + zid + ' — A ' + fmtN(zvA) + ' · B ' + fmtN(zvB) + ' · Δ ' + fmtN(zvA - zvB), margins().l, y);
        y += 12;

        const bairros = new Set([
          ...((za && za.bairroList) || []).map(b => b.nm),
          ...((zb && zb.bairroList) || []).map(b => b.nm),
        ]);
        for (const bnm of [...bairros].sort((a, b) => a.localeCompare(b, 'pt-BR'))) {
          const ba = za && za.bairros.get(bnm);
          const bb = zb && zb.bairros.get(bnm);
          const bvA = ba ? ba.v : 0, bvB = bb ? bb.v : 0;
          if (y > pageSize(doc).h - 70) { doc.addPage(); y = margins().t; }
          doc.setFont('NotoSans', 'bold'); doc.setFontSize(8); doc.setTextColor(40, 60, 90);
          doc.text('Bairro: ' + bnm + ' — A ' + fmtN(bvA) + ' · B ' + fmtN(bvB) + ' · Δ ' + fmtN(bvA - bvB), margins().l + 6, y);
          y += 10; doc.setTextColor(0);

          const escKeys = new Set([
            ...((ba && ba.escolaList) || []).map(e => e.nl + '|' + e.nm),
            ...((bb && bb.escolaList) || []).map(e => e.nl + '|' + e.nm),
          ]);
          const escMapA = new Map(((ba && ba.escolaList) || []).map(e => [e.nl + '|' + e.nm, e]));
          const escMapB = new Map(((bb && bb.escolaList) || []).map(e => [e.nl + '|' + e.nm, e]));
          const rows = [...escKeys].map(k => {
            const ea = escMapA.get(k), eb = escMapB.get(k);
            const nm = (ea || eb).nm, nl = (ea || eb).nl;
            const va = ea ? ea.v : 0, vb = eb ? eb.v : 0;
            return [nl || '—', nm, fmtN(va), fmtN(vb), fmtN(va - vb)];
          }).sort((x, y) => {
            const da = Number(String(y[2]).replace(/\./g, '')) - Number(String(x[2]).replace(/\./g, ''));
            return da;
          });
          // better sort by numeric va+vb
          rows.sort((x, y) => {
            const na = escMapA.get(x[0] + '|' + x[1]) || escMapA.get([...escMapA.keys()].find(k => k.endsWith('|' + x[1])));
            return 0;
          });
          // simple: rebuild sorted
          const escRows = [...escKeys].map(k => {
            const ea = escMapA.get(k), eb = escMapB.get(k);
            const nm = (ea || eb).nm, nl = (ea || eb).nl;
            const va = ea ? ea.v : 0, vb = eb ? eb.v : 0;
            return { nl, nm, va, vb, d: va - vb };
          }).sort((a, b) => (b.va + b.vb) - (a.va + a.vb) || a.nm.localeCompare(b.nm, 'pt-BR'));

          y = autoTable(doc, {
            startY: y,
            head: [['Nº', 'Escola / local', 'A', 'B', 'Δ']],
            body: escRows.map(e => [e.nl || '—', e.nm, fmtN(e.va), fmtN(e.vb), fmtN(e.d)]),
            styles: { font: 'NotoSans', fontSize: 6.5, cellPadding: 1.5 },
            headStyles: { fillColor: [51, 65, 85], textColor: 255, fontSize: 7 },
            margin: { left: margins().l + 6, right: margins().r },
          }) + 5;
        }
      }
    }

    writeToc(doc, bookmarks, tocPage);
    addFooterAll(doc, { subtitle: title });
    return { doc, stA, stB, treeA, treeB, cmpRows, aByI, bByI, winByI, geojson };
  }

  async function buildResumo(spec) {
    // keep lightweight resumo from before (simplified)
    const opts = Object.assign({ landscape: false, hist: true }, spec.options || {});
    const doc = newDoc(opts); await ensureFonts(doc);
    await writeCover(doc, 'Resumo da eleição — Sergipe', 'Estado de Sergipe (SE)', null, []);
    doc.addPage(); const tocPage = doc.internal.getCurrentPageInfo().pageNumber;
    const bookmarks = []; doc.addPage(); let y = margins().t;
    const blocks = spec.blocks || ['gov', 'sen', 'pres', 'fed', 'est', 'eleitos'];
    function rowsFor(codigo, topN) {
      const { dados } = cargoDados(codigo);
      let list = sortedTodos(dados);
      if (topN) list = list.slice(0, topN);
      return list.map((k, i) => [String(i + 1), String(k.n), k.nome || '', k.partido || '', fmtN(k.vap), fmtP(k.pvap), k.eleito ? 'Eleito' : (k.st || '—')]);
    }
    for (const [id, cod, label, top] of [['gov', 3, 'Governador', 0], ['sen', 5, 'Senado', 0], ['pres', 1, 'Presidente em Sergipe', 0], ['fed', 6, 'Dep. Federal (top)', 8], ['est', 7, 'Dep. Estadual (top)', 24]]) {
      if (!blocks.includes(id)) continue;
      y = sectionTitle(doc, label, y, bookmarks);
      y = autoTable(doc, { startY: y, head: [['#', 'Nº', 'Nome', 'Partido', 'Votos', '%', 'Sit.']], body: rowsFor(cod, top), styles: { font: 'NotoSans', fontSize: 8 }, headStyles: { fillColor: [30, 64, 120], textColor: 255 }, margin: { left: margins().l, right: margins().r } }) + 10;
    }
    writeToc(doc, bookmarks, tocPage);
    addFooterAll(doc, { subtitle: 'Resumo da eleição — Sergipe' });
    return { doc };
  }

  async function buildMunicipio(spec) {
    const opts = Object.assign({ topN: 10 }, spec.options || {});
    const munIdx = await loadMunIndex();
    let mun = (munIdx.muns || []).find(m => String(m.cd) === String(spec.cd));
    const doc = newDoc(opts); await ensureFonts(doc);
    const title = 'Relatório do município — ' + ((mun && mun.nm) || '—');
    await writeCover(doc, title, mun ? mun.nm + ' (CD ' + mun.cd + ')' : '—', null, []);
    doc.addPage(); const tocPage = doc.internal.getCurrentPageInfo().pageNumber;
    const bookmarks = []; doc.addPage(); let y = margins().t;
    if (!mun) y = bodyText(doc, 'Município não encontrado.', y);
    else {
      let munData = null;
      try { munData = await global.getJSON('mapa/mun/' + mun.cd + '.json'); } catch (_) {}
      for (const cg of ['3', '5', '1', '6', '7']) {
        const rows = (munData && munData.cargos && munData.cargos[cg]) || [];
        if (!rows.length) continue;
        y = sectionTitle(doc, CARGO_NOME[cg] || cg, y, bookmarks);
        y = autoTable(doc, { startY: y, head: [['#', 'Nº', 'Nome', 'Partido', 'Votos mun.', 'Total SE']], body: rows.slice(0, opts.topN || 10).map((r, i) => [String(i + 1), String(r.n), r.nm || '', r.sg || '', fmtN(r.v), fmtN(r.t)]), styles: { font: 'NotoSans', fontSize: 8 }, headStyles: { fillColor: [30, 64, 120], textColor: 255 }, margin: { left: margins().l, right: margins().r } }) + 8;
      }
    }
    writeToc(doc, bookmarks, tocPage);
    addFooterAll(doc, { subtitle: title });
    return { doc };
  }

  async function generate(spec) {
    const t = (spec && spec.template) || 'resumo';
    if (t === 'comparar' || t === 'comparativo') return (await buildComparar(spec)).doc;
    if (t === 'candidato') return (await buildCandidatoFull(spec)).doc;
    if (t === 'municipio' || t === 'mun') return (await buildMunicipio(spec)).doc;
    if (t === 'custom') {
      if (spec.a && spec.b) return (await buildComparar(spec)).doc;
      if (spec.cargo && (spec.numero || spec.n || spec.a)) return (await buildCandidatoFull(Object.assign({}, spec, { numero: spec.numero || spec.n || spec.a }))).doc;
      if (spec.cd || spec.mun) return (await buildMunicipio(spec)).doc;
    }
    return (await buildResumo(spec)).doc;
  }

  function safeFilename(s) {
    return String(s || 'relatorio').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/_+/g, '_').slice(0, 80);
  }

  async function generateAndDownload(spec) {
    const doc = await generate(spec);
    let tag = spec.template || 'resumo';
    if (spec.a && spec.b) tag = 'comparar_' + spec.a + '_vs_' + spec.b;
    else if (spec.numero || spec.n) tag += '_' + (spec.numero || spec.n);
    const fname = safeFilename('relatorio_' + tag) + '.pdf';
    doc.save(fname);
    return { doc, filename: fname };
  }

  /* ---------- Hash / UI ---------- */
  function parseRelHash() {
    const raw = (location.hash || '').replace(/^#/, '');
    if (!raw.startsWith('relatorios')) return null;
    const q = raw.indexOf('?');
    const p = new URLSearchParams(q >= 0 ? raw.slice(q + 1) : '');
    const out = { template: p.get('t') || 'resumo' };
    if (p.get('c')) out.cargo = p.get('c');
    if (p.get('n')) out.numero = p.get('n');
    if (p.get('a')) out.a = p.get('a');
    if (p.get('b')) out.b = p.get('b');
    if (p.get('cd')) out.cd = p.get('cd');
    if (p.get('mun')) out.mun = p.get('mun');
    if (out.template === 'comparativo') out.template = 'comparar';
    if ((out.a && out.b) && out.template === 'resumo') out.template = 'comparar';
    return out;
  }

  function buildRelHash(spec) {
    const p = new URLSearchParams();
    let t = spec.template || 'resumo';
    if (t === 'comparativo') t = 'comparar';
    p.set('t', t);
    if (spec.cargo || spec.c) p.set('c', String(spec.cargo || spec.c));
    if (t === 'comparar') {
      if (spec.a || spec.numero) p.set('a', String(spec.a || spec.numero));
      if (spec.b) p.set('b', String(spec.b));
    } else {
      if (spec.numero || spec.n) p.set('n', String(spec.numero || spec.n));
      if (spec.a && !spec.numero) p.set('n', String(spec.a));
    }
    if (spec.cd) p.set('cd', String(spec.cd));
    if (spec.mun) p.set('mun', String(spec.mun));
    return '#relatorios?' + p.toString();
  }

  function openInPanel(spec) {
    const hash = buildRelHash(spec);
    try { history.pushState(null, '', hash); } catch (e) { location.hash = hash; }
    if (typeof global.setView === 'function') global.setView('relatorios', false);
    bootUI();
    applySpecToUI(document.getElementById('grid-relatorios'), parseRelHash() || spec);
    // auto preview
    setTimeout(() => {
      const btn = document.getElementById('rel-preview-btn');
      if (btn) btn.click();
    }, 50);
  }

  function collectUISpec(root) {
    const mode = (root.querySelector('input[name=rel-mode]:checked') || {}).value || 'resumo';
    const landscape = !!root.querySelector('#rel-landscape')?.checked;
    const blocks = [...root.querySelectorAll('.rel-block:checked')].map(x => x.value);
    const spec = { template: mode, options: { landscape, hist: true, fotos: true }, blocks };
    if (mode === 'comparar') {
      const a = root.querySelector('#rel-cand-a')?.value || '';
      const b = root.querySelector('#rel-cand-b')?.value || '';
      if (a) { const [c, n] = a.split(':'); spec.cargo = c; spec.a = n; }
      if (b) { const [c2, n2] = b.split(':'); if (!spec.cargo) spec.cargo = c2; spec.b = n2; }
    } else if (mode === 'candidato') {
      const v = root.querySelector('#rel-cand')?.value || '';
      if (v) { const [c, n] = v.split(':'); spec.cargo = c; spec.numero = n; }
    } else if (mode === 'municipio') {
      spec.cd = root.querySelector('#rel-mun')?.value || '';
    } else if (mode === 'custom') {
      const a = root.querySelector('#rel-cand-a')?.value || root.querySelector('#rel-cand')?.value;
      const b = root.querySelector('#rel-cand-b')?.value;
      const mun = root.querySelector('#rel-mun')?.value;
      if (a && b) {
        const [c, n] = a.split(':'); const [, n2] = b.split(':');
        spec.template = 'comparar'; spec.cargo = c; spec.a = n; spec.b = n2;
      } else if (a) {
        const [c, n] = a.split(':'); spec.template = 'candidato'; spec.cargo = c; spec.numero = n;
      } else if (mun) { spec.template = 'municipio'; spec.cd = mun; }
    }
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
    if (mode === 'comparativo') mode = 'comparar';
    if (mode === 'mun') mode = 'municipio';
    const radio = root.querySelector('input[name=rel-mode][value="' + mode + '"]');
    if (radio) radio.checked = true;
    syncModePanels(root);
    const cargo = spec.cargo || spec.c || '7';
    if (mode === 'comparar') {
      if (spec.a) { const el = root.querySelector('#rel-cand-a'); if (el) el.value = cargo + ':' + spec.a; }
      if (spec.b) { const el = root.querySelector('#rel-cand-b'); if (el) el.value = cargo + ':' + spec.b; }
    } else if (spec.numero || spec.n || spec.a) {
      const n = spec.numero || spec.n || spec.a;
      const el = root.querySelector('#rel-cand'); if (el) el.value = cargo + ':' + n;
    }
    if (spec.cd) { const el = root.querySelector('#rel-mun'); if (el) el.value = String(spec.cd); }
  }

  async function fillSelectors(root) {
    if (!global.MAPA_INDEX && typeof global.loadMapaIndex === 'function') {
      try { await global.loadMapaIndex(); } catch (e) { console.warn('loadMapaIndex', e); }
    }
    const opts = ['<option value="">Escolha…</option>'];
    for (const [cg, list] of Object.entries((global.MAPA_INDEX || {}).cargos || {})) {
      if (!['1', '3', '5', '6', '7'].includes(cg)) continue;
      const group = list.map(c => '<option value="' + cg + ':' + c.n + '">' + (c.nu || c.nm) + ' (' + c.n + ' · ' + (c.sg || '') + ')</option>').join('');
      opts.push('<optgroup label="' + (CARGO_NOME[cg] || cg) + '">' + group + '</optgroup>');
    }
    const html = opts.join('');
    for (const id of ['#rel-cand', '#rel-cand-a', '#rel-cand-b', '#rel-cand-custom']) {
      const el = root.querySelector(id); if (el) el.innerHTML = html;
    }
    const idx = await loadMunIndex();
    const munHtml = ['<option value="">Escolha o município…</option>']
      .concat([...(idx.muns || [])].sort((a, b) => a.nm.localeCompare(b.nm, 'pt-BR')).map(m => '<option value="' + m.cd + '">' + m.nm + '</option>'))
      .join('');
    const mun = root.querySelector('#rel-mun'); if (mun) mun.innerHTML = munHtml;
  }

  function renderWebPreview(root, spec, built) {
    const box = root.querySelector('#rel-preview');
    if (!box) return;
    if (!built) { box.innerHTML = '<pre class="rel-preview-pre">Prévia:\n' + JSON.stringify(spec, null, 2) + '</pre>'; return; }

    if (spec.template === 'comparar' || (spec.a && spec.b)) {
      const { stA, stB, cmpRows, aByI, bByI, winByI, geojson, treeA, treeB } = built;
      const svgA = buildChoroplethSVG(geojson, aByI, { w: 480, h: 360, title: 'A — ' + stA.nome, mode: 'seq' });
      const svgB = buildChoroplethSVG(geojson, bByI, { w: 480, h: 360, title: 'B — ' + stB.nome, mode: 'seq' });
      const svgC = buildChoroplethSVG(geojson, aByI, { w: 480, h: 360, title: 'Vencedor por município', mode: 'win', winByI, aByI, bByI });
      let html = '<div class="rel-preview-rich">';
      html += '<div class="rel-exec"><div class="rel-photos">';
      html += '<img src="' + fotoPath(spec.cargo, spec.a) + '" alt="" onerror="this.style.display=\'none\'"/>';
      html += '<img src="' + fotoPath(spec.cargo, spec.b) + '" alt="" onerror="this.style.display=\'none\'"/>';
      html += '</div><div>';
      html += '<p><strong>A:</strong> ' + stA.nome + ' (' + spec.a + ') — <strong>' + fmtN(stA.vap) + '</strong> · ' + stA.st + '</p>';
      html += '<p><strong>B:</strong> ' + stB.nome + ' (' + spec.b + ') — <strong>' + fmtN(stB.vap) + '</strong> · ' + stB.st + '</p>';
      html += '<p>Δ A−B: <strong>' + fmtN(stA.vap - stB.vap) + '</strong></p></div></div>';
      html += '<div class="rel-maps">' + svgA + svgB + svgC + '</div>';
      html += '<h3>Municípios (' + cmpRows.length + ')</h3><div class="rel-drill">';
      for (const r of cmpRows) {
        html += '<details class="rel-mun"><summary><strong>' + r.nm + '</strong> — A ' + fmtN(r.a) + ' · B ' + fmtN(r.b) + ' · Δ ' + fmtN(r.d) + '</summary>';
        const zonaIds = new Set([
          ...((r.aNode && r.aNode.zonaList) || []).map(z => z.z),
          ...((r.bNode && r.bNode.zonaList) || []).map(z => z.z),
        ]);
        for (const zid of [...zonaIds].sort((a, b) => a - b)) {
          const za = r.aNode && r.aNode.zonas.get(zid);
          const zb = r.bNode && r.bNode.zonas.get(zid);
          html += '<details class="rel-zona"><summary>Zona ' + zid + ' — A ' + fmtN(za ? za.v : 0) + ' · B ' + fmtN(zb ? zb.v : 0) + '</summary>';
          const bairros = new Set([
            ...((za && za.bairroList) || []).map(b => b.nm),
            ...((zb && zb.bairroList) || []).map(b => b.nm),
          ]);
          for (const bnm of [...bairros].sort((a, b) => a.localeCompare(b, 'pt-BR'))) {
            const ba = za && za.bairros.get(bnm);
            const bb = zb && zb.bairros.get(bnm);
            html += '<details class="rel-bairro"><summary>Bairro ' + bnm + ' — A ' + fmtN(ba ? ba.v : 0) + ' · B ' + fmtN(bb ? bb.v : 0) + '</summary><table class="rel-esc"><thead><tr><th>Nº</th><th>Escola</th><th>A</th><th>B</th><th>Δ</th></tr></thead><tbody>';
            const escKeys = new Set([
              ...((ba && ba.escolaList) || []).map(e => e.nl + '|' + e.nm),
              ...((bb && bb.escolaList) || []).map(e => e.nl + '|' + e.nm),
            ]);
            const mapA = new Map(((ba && ba.escolaList) || []).map(e => [e.nl + '|' + e.nm, e]));
            const mapB = new Map(((bb && bb.escolaList) || []).map(e => [e.nl + '|' + e.nm, e]));
            for (const k of escKeys) {
              const ea = mapA.get(k), eb = mapB.get(k);
              const va = ea ? ea.v : 0, vb = eb ? eb.v : 0;
              const nm = (ea || eb).nm, nl = (ea || eb).nl;
              html += '<tr><td>' + (nl || '—') + '</td><td>' + nm + '</td><td>' + fmtN(va) + '</td><td>' + fmtN(vb) + '</td><td>' + fmtN(va - vb) + '</td></tr>';
            }
            html += '</tbody></table></details>';
          }
          html += '</details>';
        }
        html += '</details>';
      }
      html += '</div></div>';
      box.innerHTML = html;
      return;
    }

    box.innerHTML = '<pre class="rel-preview-pre">Prévia pronta para PDF.\n' + JSON.stringify(spec, null, 2) + '</pre>';
  }

  function bootUI() {
    const root = document.getElementById('grid-relatorios');
    if (!root) return;
    if (!root.dataset.booted) {
      root.dataset.booted = '1';
      root.innerHTML = [
        '<section class="card span-all rel-card">',
        '<h2>Relatórios (PDF)</h2>',
        '<p class="meta">PDFs no navegador com mapas coropléticos de Sergipe, fotos e detalhe completo (município → zona → bairro → escola). Sumário clicável + favoritos.</p>',
        '<div class="rel-modes" role="radiogroup">',
        '<label><input type="radio" name="rel-mode" value="resumo" checked> Resumo</label>',
        '<label><input type="radio" name="rel-mode" value="candidato"> Candidato</label>',
        '<label><input type="radio" name="rel-mode" value="comparar"> Comparativo A×B</label>',
        '<label><input type="radio" name="rel-mode" value="municipio"> Município</label>',
        '<label><input type="radio" name="rel-mode" value="custom"> Personalizado</label>',
        '</div>',
        '<div class="rel-mode-panel" data-mode="candidato"><label class="rel-field">Candidato <select id="rel-cand"></select></label></div>',
        '<div class="rel-mode-panel" data-mode="comparar" hidden>',
        '<label class="rel-field">Candidato A <select id="rel-cand-a"></select></label>',
        '<label class="rel-field">Candidato B <select id="rel-cand-b"></select></label>',
        '</div>',
        '<div class="rel-mode-panel" data-mode="municipio" hidden><label class="rel-field">Município <select id="rel-mun"></select></label></div>',
        '<div class="rel-mode-panel" data-mode="custom" hidden><p class="meta">Use Comparativo ou Candidato — blocos abaixo valem para Resumo.</p></div>',
        '<div id="rel-blocks" class="rel-blocks"><div class="meta">Blocos (resumo)</div>',
        BLOCKS.map(b => '<label><input class="rel-block" type="checkbox" value="' + b.id + '" checked> ' + b.label + '</label>').join(' '),
        '</div>',
        '<div class="rel-opts"><label><input type="checkbox" id="rel-landscape"> Paisagem</label></div>',
        '<div class="rel-actions">',
        '<button type="button" class="btn-mapa" id="rel-preview-btn">Atualizar prévia</button>',
        '<button type="button" class="btn-mapa" id="rel-pdf-btn">Gerar PDF</button>',
        '</div>',
        '<div id="rel-preview" class="rel-preview">Escolha um modelo e atualize a prévia.</div>',
        '</section>'
      ].join('');

      root.querySelectorAll('input[name=rel-mode]').forEach(r => r.addEventListener('change', () => syncModePanels(root)));

      root.querySelector('#rel-preview-btn').addEventListener('click', async () => {
        const spec = collectUISpec(root);
        const box = root.querySelector('#rel-preview');
        box.textContent = 'Montando prévia…';
        try {
          history.replaceState(null, '', buildRelHash(spec));
          let built = null;
          if (spec.template === 'comparar' && spec.a && spec.b) {
            const geojson = await loadGeoMun();
            const geo = await loadGeoLoc();
            const treeA = buildVoteTree(geo, await loadCandFile(spec.cargo, spec.a) || { v: [] });
            const treeB = buildVoteTree(geo, await loadCandFile(spec.cargo, spec.b) || { v: [] });
            const munIdx = await loadMunIndex();
            const munNames = new Map((munIdx.muns || []).map(m => [m.i, m.nm]));
            const cmpRows = mergeCompareTrees(treeA, treeB, munNames);
            built = {
              stA: candState(spec.cargo, spec.a), stB: candState(spec.cargo, spec.b),
              cmpRows, treeA, treeB, geojson,
              aByI: new Map([...treeA.byI.entries()].map(([i, n]) => [i, n.v])),
              bByI: new Map([...treeB.byI.entries()].map(([i, n]) => [i, n.v])),
              winByI: new Map(cmpRows.map(r => [r.i, r.winner])),
            };
          }
          renderWebPreview(root, spec, built);
        } catch (e) {
          console.error(e);
          box.textContent = 'Erro na prévia: ' + (e.message || e);
        }
      });

      root.querySelector('#rel-pdf-btn').addEventListener('click', async () => {
        const btn = root.querySelector('#rel-pdf-btn');
        const spec = collectUISpec(root);
        if (spec.template === 'comparar' && (!spec.a || !spec.b)) {
          root.querySelector('#rel-preview').textContent = 'Selecione candidatos A e B.'; return;
        }
        if (spec.template === 'candidato' && !spec.numero) {
          root.querySelector('#rel-preview').textContent = 'Selecione um candidato.'; return;
        }
        btn.disabled = true;
        root.querySelector('#rel-preview').textContent = 'Gerando PDF (pode demorar no comparativo completo)…';
        try {
          const { filename } = await generateAndDownload(spec);
          root.querySelector('#rel-preview').textContent = 'PDF gerado: ' + filename;
          history.replaceState(null, '', buildRelHash(spec));
          // refresh rich preview too
          root.querySelector('#rel-preview-btn').click();
        } catch (e) {
          console.error(e);
          root.querySelector('#rel-preview').textContent = 'Erro: ' + (e.message || e);
        } finally { btn.disabled = false; }
      });
    }
    const pending = parseRelHash();
    fillSelectors(root).then(() => {
      const hs = pending || parseRelHash();
      if (hs) applySpecToUI(root, hs);
    }).catch(e => console.warn('fillSelectors', e));
    syncModePanels(root);
  }

  function applyHashFromLocation() {
    const hs = parseRelHash();
    if (!hs) return;
    const viewEl = document.getElementById('view-relatorios');
    const already = viewEl && viewEl.classList.contains('active');
    if (!already && typeof global.setView === 'function') global.setView('relatorios', false);
    bootUI();
    const root = document.getElementById('grid-relatorios');
    if (root) applySpecToUI(root, hs);
  }

  global.Relatorios = {
    generate, generateAndDownload, openInPanel, bootUI, parseRelHash, buildRelHash,
    applySpecToUI, applyHashFromLocation, BLOCKS, CARGO_NOME,
    buildChoroplethSVG, buildVoteTree, // exposed for mapa panel reuse
  };

  function autoBoot() {
    if ((location.hash || '').replace(/^#/, '').startsWith('relatorios')) applyHashFromLocation();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoBoot);
  else autoBoot();
})(window);
