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

  function situacaoFmt(me) {
    if (!me) return '—';
    const st = String(me.st || '').trim();
    if (st) return st;
    if (me.eleito) return 'Eleito';
    return '—';
  }

  function rankFromMapaIndex(cargo, numero) {
    const raw = (((global.MAPA_INDEX || {}).cargos || {})[String(cargo)] || []);
    // candidatos com nº de urna (exclui legendas 1–2 dígitos quando houver misturados)
    const list = raw.filter(c => String(c.n || '').length >= 3 || Number(c.t) > 0)
      .slice()
      .sort((a, b) => (b.t || 0) - (a.t || 0) || String(a.n).localeCompare(String(b.n)));
    const idx = list.findIndex(c => String(c.n) === String(numero));
    if (idx < 0) return { rank: null, total: list.length, vap: 0, partido: '', partyRank: null, partyTotal: 0 };
    const me = list[idx];
    const party = list.filter(c => (c.sg || '') === (me.sg || ''));
    const partyRank = party.findIndex(c => String(c.n) === String(numero)) + 1;
    return {
      rank: idx + 1, total: list.length, vap: me.t || 0, partido: me.sg || '',
      partyRank: partyRank || null, partyTotal: party.length,
    };
  }

  function candState(cargo, numero) {
    const { dados } = cargoDados(Number(cargo));
    const all = sortedTodos(dados);
    const me = all.find(k => String(k.n) === String(numero));
    const meta = metaCand(cargo, numero);
    const fb = rankFromMapaIndex(cargo, numero);
    let rank = me ? all.findIndex(k => String(k.n) === String(numero)) + 1 : fb.rank;
    let total = all.length || fb.total;
    const partyKey = (me && me.partido) || meta.sg || fb.partido || '';
    const partyList = all.length
      ? all.filter(k => (k.partido || '') === partyKey)
      : [];
    let partyRank = me && partyList.length
      ? partyList.findIndex(k => String(k.n) === String(numero)) + 1
      : fb.partyRank;
    let partyTotal = partyList.length || fb.partyTotal;
    const vap = me ? me.vap : (fb.vap || meta.t || 0);
    let pvap = me ? me.pvap : null;
    if (pvap == null && dados && dados.votosValidos) {
      pvap = dados.votosValidos > 0 ? (100 * vap / dados.votosValidos) : null;
    }
    if (pvap == null && all.length) {
      const sum = all.reduce((s, k) => s + (k.vap || 0), 0);
      if (sum > 0) pvap = 100 * vap / sum;
    }
    return {
      meta, me, rank, total, partyRank, partyTotal,
      vap, pvap,
      st: situacaoFmt(me),
      eleito: !!(me && me.eleito),
      hist: histOf(Number(cargo), numero),
      nome: (me && me.nome) || meta.nu || meta.nm || String(numero),
      nomeCompleto: meta.nm || (me && me.nome) || '',
      partido: partyKey || meta.sg || (me && me.partido) || '',
      numero: String(numero),
    };
  }

  async function ensureCargoEstado(cargo) {
    const code = Number(cargo);
    let { dados } = cargoDados(code);
    if (dados && Array.isArray(dados.todos) && dados.todos.length) return dados;
    // espera o painel terminar de puxar o TSE
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 250));
      dados = cargoDados(code).dados;
      if (dados && Array.isArray(dados.todos) && dados.todos.length) return dados;
    }
    // tenta buscar direto
    try {
      if (typeof global.buscarCargo === 'function' && global.CONFIG) {
        const cfg = (global.CONFIG.cargos || []).find(c => c.codigo === code && (!c.uf || c.uf === 'se' || c.uf === global.CONFIG.uf));
        if (cfg) {
          const norm = await global.buscarCargo(cfg);
          const key = global.chaveDe ? global.chaveDe(cfg) : code;
          if (!global.estado) global.estado = {};
          global.estado[key] = { dados: norm, erro: null, recebidoEm: Date.now() };
          if (typeof global.syncRelGlobals === 'function') global.syncRelGlobals();
          return norm;
        }
      }
    } catch (e) { console.warn('ensureCargoEstado fetch', e); }
    return cargoDados(code).dados;
  }

  function computeKeyStats(tree, cmpRows, side) {
    const munComVoto = tree.munList.filter(m => m.v > 0).length;
    const top5 = tree.munList.slice(0, 5);
    const top3Sum = tree.munList.slice(0, 3).reduce((s, m) => s + m.v, 0);
    const conc = tree.total > 0 ? (100 * top3Sum / tree.total) : 0;
    const wins = (cmpRows || []).filter(r => r.winner === side).length;
    return { munComVoto, top5, conc, wins, totalMun: (cmpRows || []).length || tree.munList.length };
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

  /* ---------- Choropleth (quantile + win margin) ---------- */
  const SEQ = ['#fff7bc', '#fee391', '#fec44f', '#fe9929', '#ec7014', '#cc4c02', '#8c2d04'];

  function quantileBreaks(values, nClasses) {
    const sorted = values.filter(v => Number.isFinite(v) && v > 0).slice().sort((a, b) => a - b);
    const n = Math.max(2, Math.min(nClasses || 7, SEQ.length));
    if (!sorted.length) return { breaks: [0, 1], colors: SEQ.slice(0, n) };
    const breaks = [];
    for (let i = 0; i <= n; i++) {
      if (i === 0) { breaks.push(sorted[0]); continue; }
      if (i === n) { breaks.push(sorted[sorted.length - 1]); continue; }
      const pos = (i / n) * (sorted.length - 1);
      const lo = Math.floor(pos), hi = Math.ceil(pos);
      const v = lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
      breaks.push(Math.round(v));
    }
    // garantir monotonia estrita o quanto possível
    for (let i = 1; i < breaks.length; i++) {
      if (breaks[i] <= breaks[i - 1]) breaks[i] = breaks[i - 1] + 1;
    }
    return { breaks, colors: SEQ.slice(0, n) };
  }

  function classForValue(v, breaks) {
    if (!v || v <= 0) return -1;
    for (let i = 0; i < breaks.length - 1; i++) {
      if (i === breaks.length - 2) {
        if (v >= breaks[i] && v <= breaks[i + 1]) return i;
      } else if (v >= breaks[i] && v < breaks[i + 1]) return i;
    }
    return breaks.length - 2;
  }

  function featureCentroid(f, proj) {
    let sx = 0, sy = 0, n = 0;
    function walk(c) {
      if (typeof c[0] === 'number') {
        const [x, y] = proj(c[0], c[1]);
        sx += x; sy += y; n++;
      } else c.forEach(walk);
    }
    walk(f.geometry.coordinates);
    if (!n) return null;
    return [sx / n, sy / n];
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
    const munNames = (opts && opts.munNames) || null;
    const legendH = mode === 'seq' ? 56 : 42;
    const bb = bboxOf(geojson);
    const proj = projectFactory(bb, W, H - legendH, 10);

    const vals = [];
    for (const f of geojson.features) vals.push(valueByI.get(f.properties.i) || 0);
    const { breaks, colors } = quantileBreaks(vals, 7);

    let paths = '';
    const labelCandidates = [];
    for (const f of geojson.features) {
      const i = f.properties.i;
      let fill = '#e2e8f0';
      const v = valueByI.get(i) || 0;
      if (mode === 'win') {
        const winMap = (opts && opts.winByI) || new Map();
        const winner = winMap.get(i);
        const va = ((opts && opts.aByI) || new Map()).get(i) || 0;
        const vb = ((opts && opts.bByI) || new Map()).get(i) || 0;
        const tot = va + vb;
        if (winner === 'empate') fill = '#94a3b8';
        else if (winner === 'a' || winner === 'b') {
          const margin = tot > 0 ? Math.abs(va - vb) / tot : 0;
          const t = 0.28 + 0.72 * margin; // intensidade pela margem
          if (winner === 'a') fill = `rgba(37,99,235,${t.toFixed(2)})`;
          else fill = `rgba(220,38,38,${t.toFixed(2)})`;
        }
      } else {
        const ci = classForValue(v, breaks);
        fill = ci < 0 ? '#f1f5f9' : colors[ci];
      }
      const d = geomPath(f.geometry, proj);
      const tip = (f.properties.nm || '') + ': ' + fmtN(v);
      paths += `<path d="${d}" fill="${fill}" stroke="#64748b" stroke-width="0.45" data-i="${i}"><title>${tip.replace(/[<>&"]/g, '')}</title></path>`;
      if (mode === 'seq' && v > 0) {
        const c = featureCentroid(f, proj);
        if (c) labelCandidates.push({ i, v, nm: f.properties.nm || (munNames && munNames.get(i)) || '', x: c[0], y: c[1] + (title ? 8 : 0) });
      }
    }

    let labels = '';
    if (mode === 'seq') {
      labelCandidates.sort((a, b) => b.v - a.v);
      for (const L of labelCandidates.slice(0, 5)) {
        const short = String(L.nm || '').split(' ')[0].slice(0, 12);
        labels += `<g>
          <text x="${L.x.toFixed(1)}" y="${L.y.toFixed(1)}" text-anchor="middle" font-size="8" font-weight="700" fill="#0f172a" stroke="#f8fafc" stroke-width="2.5" paint-order="stroke">${short}</text>
          <text x="${L.x.toFixed(1)}" y="${(L.y + 9).toFixed(1)}" text-anchor="middle" font-size="7" fill="#334155" stroke="#f8fafc" stroke-width="2" paint-order="stroke">${fmtN(L.v)}</text>
        </g>`;
      }
    }

    let legend = '';
    if (mode === 'seq') {
      const n = colors.length;
      const lw = W - 20, lh = 12, lx = 10, ly = H - 28;
      const cw = lw / n;
      legend = `<text x="10" y="${H - 42}" font-size="10" fill="#334155">Classes (quantis) — menos → mais votos</text>`;
      colors.forEach((c, i) => {
        const from = breaks[i], to = breaks[i + 1];
        const lab = i === n - 1 ? (fmtN(from) + '–' + fmtN(to)) : (fmtN(from) + '–' + fmtN(Math.max(from, to - 1)));
        legend += `<rect x="${lx + i * cw}" y="${ly}" width="${cw - 1}" height="${lh}" fill="${c}" stroke="#94a3b8" stroke-width="0.3"/>`;
        legend += `<text x="${lx + i * cw + cw / 2}" y="${ly + lh + 10}" font-size="7.5" fill="#475569" text-anchor="middle">${lab}</text>`;
      });
    } else {
      legend = `<rect x="10" y="${H - 34}" width="14" height="10" fill="rgba(37,99,235,0.95)"/>`
        + `<text x="28" y="${H - 25}" font-size="10" fill="#334155">A vence</text>`
        + `<rect x="100" y="${H - 34}" width="14" height="10" fill="rgba(220,38,38,0.95)"/>`
        + `<text x="118" y="${H - 25}" font-size="10" fill="#334155">B vence</text>`
        + `<rect x="190" y="${H - 34}" width="14" height="10" fill="#94a3b8"/>`
        + `<text x="208" y="${H - 25}" font-size="10" fill="#334155">Empate</text>`
        + `<text x="10" y="${H - 10}" font-size="8.5" fill="#64748b">Intensidade = margem de vitória no município (clara → forte)</text>`;
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <rect width="100%" height="100%" fill="#f8fafc"/>
      ${title ? `<text x="10" y="16" font-size="12" font-weight="700" fill="#0f172a">${title.replace(/[<>]/g, '')}</text>` : ''}
      <g transform="translate(0,${title ? 8 : 0})">${paths}${labels}</g>
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

  function sectionTitle(doc, title, y, bookmarks, anchorId, minBelow) {
    const m = margins();
    const { w, h } = pageSize(doc);
    // jsPDF text usa baseline: deixa folga acima para não invadir tabela anterior
    if (y > m.t + 2) y += 12;
    const need = 22 + (minBelow || 0);
    if (y + need > h - m.b) { doc.addPage(); y = m.t; }
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

  const MM = 2.834645669;

  function drawInitialsAvatar(doc, x, y, w, h, nome) {
    doc.setFillColor(30, 41, 59);
    doc.roundedRect(x, y, w, h, 3, 3, 'F');
    const parts = String(nome || '?').trim().split(/\s+/).filter(Boolean);
    const ini = !parts.length ? '?' : (parts.length === 1 ? parts[0].slice(0, 2) : (parts[0][0] + parts[parts.length - 1][0])).toUpperCase();
    doc.setFont('NotoSans', 'bold'); doc.setFontSize(14); doc.setTextColor(248, 250, 252);
    doc.text(ini, x + w / 2, y + h / 2 + 5, { align: 'center' });
    doc.setTextColor(0);
  }

  /** Card A/B: foto 30×40mm + metadados. Retorna y final. */
  function writeCandCard(doc, x, y, cardW, st, photo, tag) {
    const phW = 30 * MM, phH = 40 * MM;
    const pad = 8;
    const lines = [];
    lines.push(tag + ' · nº ' + st.numero + (st.partido ? ' · ' + st.partido : ''));
    lines.push(st.nome);
    if (st.nomeCompleto && st.nomeCompleto !== st.nome) lines.push(st.nomeCompleto);
    lines.push('Votos: ' + fmtN(st.vap) + (st.pvap != null ? '  (' + fmtP(st.pvap) + ' dos válidos)' : ''));
    lines.push('Ranking cargo: ' + (st.rank ? st.rank + 'º de ' + st.total : '—'));
    lines.push('Ranking partido/fed.: ' + (st.partyRank ? st.partyRank + 'º de ' + st.partyTotal : '—'));
    lines.push('Situação: ' + (st.st || '—'));
    lines.push('Histórico: ' + histLine(st.hist));

    doc.setFont('NotoSans', 'normal'); doc.setFontSize(8.5);
    const textW = cardW - pad * 2 - phW - 8;
    let textH = 0;
    const wrapped = [];
    for (const raw of lines) {
      const ls = doc.splitTextToSize(raw, textW);
      wrapped.push(ls);
      textH += ls.length * 11;
    }
    const cardH = Math.max(phH + pad * 2, textH + pad * 2 + 4);

    doc.setDrawColor(148, 163, 184);
    doc.setFillColor(248, 250, 252);
    doc.setLineWidth(0.6);
    doc.roundedRect(x, y, cardW, cardH, 5, 5, 'FD');

    const imgX = x + pad, imgY = y + pad;
    if (photo) {
      try {
        doc.addImage(photo, 'JPEG', imgX, imgY, phW, phH);
      } catch (e) {
        try { doc.addImage(photo, 'PNG', imgX, imgY, phW, phH); }
        catch (_) { drawInitialsAvatar(doc, imgX, imgY, phW, phH, st.nome); }
      }
      doc.setDrawColor(100, 116, 139);
      doc.rect(imgX, imgY, phW, phH);
    } else {
      drawInitialsAvatar(doc, imgX, imgY, phW, phH, st.nome);
    }

    let ty = y + pad + 10;
    const tx = imgX + phW + 8;
    wrapped.forEach((ls, idx) => {
      doc.setFont('NotoSans', idx <= 1 ? 'bold' : 'normal');
      doc.setFontSize(idx === 1 ? 10 : 8.2);
      doc.setTextColor(idx === 0 ? 30 : 15, idx === 0 ? 64 : 23, idx === 0 ? 120 : 42);
      for (const line of ls) {
        doc.text(line, tx, ty);
        ty += 11;
      }
    });
    doc.setTextColor(0);
    return y + cardH;
  }

  function writeKeyStatsBlock(doc, y, label, stats, munNames) {
    const top = (stats.top5 || []).map((m, i) => (i + 1) + '. ' + (munNames.get(m.i) || m.i) + ' (' + fmtN(m.v) + ')').join(' · ');
    const txt = [
      label + ' — municípios com voto: ' + stats.munComVoto + ' de ' + stats.totalMun
        + ' · vence o confronto em ' + stats.wins + ' município(s)',
      'Concentração (top 3 municípios): ' + fmtP(stats.conc),
      'Top 5: ' + (top || '—'),
    ].join('\n');
    return bodyText(doc, txt, y);
  }

  function placeMapImage(doc, y, png, mapW, mapH) {
    const m = margins();
    const { h } = pageSize(doc);
    if (y + mapH > h - m.b) { doc.addPage(); y = m.t; }
    doc.addImage(png, 'PNG', m.l, y, mapW, mapH);
    return y + mapH + 10;
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

  function writeToc(doc, bookmarks, tocPage, tocPageCount) {
    const m = margins(); const { w, h } = pageSize(doc);
    const linesPer = Math.max(20, Math.floor((h - m.t - m.b - 22) / 14));
    const need = Math.max(1, Math.ceil((bookmarks.length + 1) / linesPer));
    const reserved = Math.max(1, tocPageCount || need);
    let pageIdx = 0;
    doc.setPage(tocPage);
    let y = m.t;
    doc.setFont('NotoSans', 'bold'); doc.setFontSize(14); doc.text('Sumário', m.l, y); y += 22;
    doc.setFont('NotoSans', 'normal'); doc.setFontSize(9.5);
    for (const b of bookmarks) {
      if (y > h - m.b) {
        pageIdx++;
        if (pageIdx < reserved) {
          doc.setPage(tocPage + pageIdx);
        } else {
          // overflow raro: anexa ao fim (evita quebrar conteúdo já paginado)
          doc.addPage();
        }
        y = m.t;
      }
      const title = b.title.length > 78 ? b.title.slice(0, 76) + '…' : b.title;
      doc.setTextColor(20, 60, 120); doc.text(title, m.l, y);
      doc.setTextColor(80); doc.text(String(b.page), w - m.r, y, { align: 'right' });
      try { doc.link(m.l, y - 9, w - m.l - m.r, 12, { pageNumber: b.page }); } catch (e) {}
      y += 13;
    }
    doc.setTextColor(0);
    addBookmark(doc, 'Sumário', tocPage);
  }

  function reserveTocPages(doc, approxEntries) {
    const m = margins(); const { h } = pageSize(doc);
    const linesPer = Math.max(20, Math.floor((h - m.t - m.b - 22) / 13));
    const need = Math.max(2, Math.ceil((approxEntries + 2) / linesPer));
    doc.addPage();
    const tocPage = doc.internal.getCurrentPageInfo().pageNumber;
    for (let i = 1; i < need; i++) doc.addPage();
    return { tocPage, tocPageCount: need };
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
    await ensureCargoEstado(cargo);
    const st = candState(cargo, numero);
    const photo = await loadImageDataUrl(fotoPath(cargo, numero));
    const doc = newDoc(opts); await ensureFonts(doc);
    const title = 'Relatório completo — ' + st.nome;
    const scope = (CARGO_NOME[cargo] || cargo) + ' · nº ' + numero + (st.partido ? ' · ' + st.partido : '');
    await writeCover(doc, title, scope, 'Foto local (repositório). Detalhamento completo município → zona → bairro → escola.', photo ? [photo] : []);

    const { tocPage, tocPageCount } = reserveTocPages(doc, 90);
    const bookmarks = [];
    doc.addPage(); let y = margins().t;
    const m0 = margins();
    const cardW0 = pageSize(doc).w - m0.l - m0.r;

    y = sectionTitle(doc, 'Resumo executivo', y, bookmarks, 'resumo', 150);
    y = writeCandCard(doc, m0.l, y, cardW0, st, photo, 'Candidato') + 8;

    const geojson = await loadGeoMun();
    const geo = await loadGeoLoc();
    const cand = await loadCandFile(cargo, numero);
    const tree = buildVoteTree(geo, cand || { v: [] });
    const valueByI = new Map([...tree.byI.entries()].map(([i, n]) => [i, n.v]));
    const munIdx0 = await loadMunIndex();
    const munNames0 = new Map((munIdx0.muns || []).map(mm => [mm.i, mm.nm]));
    const stats0 = computeKeyStats(tree, null, 'a');
    stats0.wins = 0; stats0.totalMun = tree.munList.length;
    y = writeKeyStatsBlock(doc, y, st.nome, stats0, munNames0);

    y = sectionTitle(doc, 'Mapa por município (votos)', y, bookmarks, 'mapa', 408);
    const svg = buildChoroplethSVG(geojson, valueByI, { w: 520, h: 400, title: st.nome + ' (quantis)', mode: 'seq', munNames: munNames0 });
    try {
      const png = await svgToPngDataUrl(svg, 1040, 800);
      y = placeMapImage(doc, y, png, 520, 400);
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
          }) + 12;
        }
      }
    }

    writeToc(doc, bookmarks, tocPage, tocPageCount);
    addFooterAll(doc, { subtitle: title });
    return { doc, tree, st, svg };
  }

  async function buildComparar(spec) {
    const cargo = String(spec.cargo || spec.c || '7');
    const aN = String(spec.a || spec.numero || '');
    const bN = String(spec.b || '');
    const opts = Object.assign({ landscape: false }, spec.options || {});
    await ensureCargoEstado(cargo);
    const stA = candState(cargo, aN);
    const stB = candState(cargo, bN);
    const photoA = await loadImageDataUrl(fotoPath(cargo, aN));
    const photoB = await loadImageDataUrl(fotoPath(cargo, bN));
    const doc = newDoc(opts); await ensureFonts(doc);
    const title = 'Comparativo — ' + stA.nome + ' × ' + stB.nome;
    const scope = (CARGO_NOME[cargo] || cargo) + ' · ' + aN + ' vs ' + bN;
    await writeCover(doc, title, scope, 'Comparativo zoneado completo (município → zona → bairro → escola). Fotos do repositório local.', [photoA, photoB].filter(Boolean));

    const { tocPage, tocPageCount } = reserveTocPages(doc, 90);
    const bookmarks = [];
    doc.addPage(); let y = margins().t;
    const m = margins();
    const pageW = pageSize(doc).w;
    const gap = 10;
    const cardW = (pageW - m.l - m.r - gap) / 2;

    y = sectionTitle(doc, 'Resumo executivo', y, bookmarks, 'resumo', 160);
    const yCardA = writeCandCard(doc, m.l, y, cardW, stA, photoA, 'A');
    const yCardB = writeCandCard(doc, m.l + cardW + gap, y, cardW, stB, photoB, 'B');
    y = Math.max(yCardA, yCardB) + 10;
    y = bodyText(doc, 'Diferença A−B (estado): ' + fmtN(stA.vap - stB.vap)
      + (stA.pvap != null && stB.pvap != null ? '  ·  Δ pp: ' + fmtP(stA.pvap - stB.pvap) : ''), y);

    const geojson = await loadGeoMun();
    const geo = await loadGeoLoc();
    const candA = await loadCandFile(cargo, aN);
    const candB = await loadCandFile(cargo, bN);
    const treeA = buildVoteTree(geo, candA || { v: [] });
    const treeB = buildVoteTree(geo, candB || { v: [] });
    const munIdx = await loadMunIndex();
    const munNames = new Map((munIdx.muns || []).map(mm => [mm.i, mm.nm]));
    const cmpRows = mergeCompareTrees(treeA, treeB, munNames);

    const aByI = new Map([...treeA.byI.entries()].map(([i, n]) => [i, n.v]));
    const bByI = new Map([...treeB.byI.entries()].map(([i, n]) => [i, n.v]));
    const winByI = new Map(cmpRows.map(r => [r.i, r.winner]));

    const statsA = computeKeyStats(treeA, cmpRows, 'a');
    const statsB = computeKeyStats(treeB, cmpRows, 'b');
    y = writeKeyStatsBlock(doc, y, 'A (' + stA.nome + ')', statsA, munNames);
    y = writeKeyStatsBlock(doc, y, 'B (' + stB.nome + ')', statsB, munNames);

    const mapW = 520, mapH = 390;
    // Mapa A — heading stays with map
    y = sectionTitle(doc, 'Mapa A — ' + stA.nome, y, bookmarks, 'mapa-a', mapH + 8);
    try {
      const svgA = buildChoroplethSVG(geojson, aByI, { w: mapW, h: mapH, title: 'Votos por município — A (quantis)', mode: 'seq', munNames });
      const pngA = await svgToPngDataUrl(svgA, mapW * 2, mapH * 2);
      y = placeMapImage(doc, y, pngA, mapW, mapH);
    } catch (e) { y = bodyText(doc, 'Mapa A indisponível: ' + (e.message || e), y); }

    y = sectionTitle(doc, 'Mapa B — ' + stB.nome, y, bookmarks, 'mapa-b', mapH + 8);
    try {
      const svgB = buildChoroplethSVG(geojson, bByI, { w: mapW, h: mapH, title: 'Votos por município — B (quantis)', mode: 'seq', munNames });
      const pngB = await svgToPngDataUrl(svgB, mapW * 2, mapH * 2);
      y = placeMapImage(doc, y, pngB, mapW, mapH);
    } catch (e) { y = bodyText(doc, 'Mapa B indisponível: ' + (e.message || e), y); }

    y = sectionTitle(doc, 'Mapa comparativo (quem venceu o município)', y, bookmarks, 'mapa-cmp', mapH + 8);
    try {
      const svgC = buildChoroplethSVG(geojson, aByI, { w: mapW, h: mapH, title: 'Vencedor por município (intensidade = margem)', mode: 'win', winByI, aByI, bByI, munNames });
      const pngC = await svgToPngDataUrl(svgC, mapW * 2, mapH * 2);
      y = placeMapImage(doc, y, pngC, mapW, mapH);
    } catch (e) { y = bodyText(doc, 'Mapa comparativo indisponível: ' + (e.message || e), y); }

    y = sectionTitle(doc, 'Todos os municípios (A, B, diferença)', y, bookmarks, 'idx-mun');
    y = autoTable(doc, {
      startY: y,
      head: [['Município', 'A', 'B', 'A−B', 'Vencedor']],
      body: cmpRows.map(r => [r.nm, fmtN(r.a), fmtN(r.b), fmtN(r.d), r.winner === 'a' ? 'A' : r.winner === 'b' ? 'B' : '=']),
      styles: { font: 'NotoSans', fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [30, 64, 120], textColor: 255 },
      margin: { left: margins().l, right: margins().r },
    }) + 14;

    // Full drill-down per município
    for (const r of cmpRows) {
      y = sectionTitle(doc, r.nm + ' — A ' + fmtN(r.a) + ' · B ' + fmtN(r.b) + ' · Δ ' + fmtN(r.d), y, bookmarks, 'mun-' + r.i, 70);
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
          }) + 12;
        }
      }
    }

    writeToc(doc, bookmarks, tocPage, tocPageCount);
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

  function normalizeSpec(spec) {
    const s = Object.assign({}, spec || {});
    let t = s.template || 'resumo';
    if (t === 'comparativo') t = 'comparar';
    if (t === 'mun') t = 'municipio';
    s.template = t;
    // Nunca misturar estado de outro modelo
    if (t === 'candidato') {
      delete s.b;
      if (!s.numero && !s.n && s.a) s.numero = s.a;
      delete s.a;
    } else if (t === 'comparar') {
      if (!s.a && s.numero) s.a = s.numero;
    } else if (t === 'municipio') {
      delete s.a; delete s.b; delete s.numero; delete s.n;
      if (!s.cd && s.mun) s.cd = s.mun;
    } else if (t === 'resumo') {
      delete s.a; delete s.b; delete s.numero; delete s.n; delete s.cd;
    } else if (t === 'custom') {
      // custom decide abaixo em generate
    }
    return s;
  }

  async function generate(spec) {
    const s = normalizeSpec(spec);
    const t = s.template || 'resumo';
    if (t === 'comparar') return (await buildComparar(s)).doc;
    if (t === 'candidato') return (await buildCandidatoFull(s)).doc;
    if (t === 'municipio') return (await buildMunicipio(s)).doc;
    if (t === 'custom') {
      if (s.a && s.b) return (await buildComparar(Object.assign({}, s, { template: 'comparar' }))).doc;
      if (s.cargo && (s.numero || s.n || s.a)) return (await buildCandidatoFull(Object.assign({}, s, { template: 'candidato', numero: s.numero || s.n || s.a }))).doc;
      if (s.cd || s.mun) return (await buildMunicipio(Object.assign({}, s, { template: 'municipio' }))).doc;
      return (await buildResumo(Object.assign({}, s, { template: 'resumo' }))).doc;
    }
    return (await buildResumo(s)).doc;
  }

  function safeFilename(s) {
    return String(s || 'relatorio').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/_+/g, '_').slice(0, 80);
  }

  async function generateAndDownload(spec) {
    const s = normalizeSpec(spec);
    const doc = await generate(s);
    let tag = s.template || 'resumo';
    if (s.template === 'comparar' && s.a && s.b) tag = 'comparar_' + s.a + '_vs_' + s.b;
    else if (s.template === 'candidato' && (s.numero || s.n)) tag = 'candidato_' + (s.numero || s.n);
    else if (s.template === 'municipio' && (s.cd || s.mun)) tag = 'municipio_' + (s.cd || s.mun);
    const fname = safeFilename('relatorio_' + tag) + '.pdf';
    doc.save(fname);
    return { doc, filename: fname, spec: s };
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
    // só promove a comparar se o hash não pediu outro modelo explicitamente
    if ((out.a && out.b) && (out.template === 'resumo' || !p.get('t'))) out.template = 'comparar';
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
    } else if (t === 'candidato') {
      const n = spec.numero || spec.n || spec.a;
      if (n) p.set('n', String(n));
    } else if (t === 'municipio') {
      if (spec.cd || spec.mun) p.set('cd', String(spec.cd || spec.mun));
    }
    // resumo/custom: só t (+c se fizer sentido)
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
      // Personalizado: usa só o que o painel custom expõe (candidato único OU mun OU A×B se ambos setados via pickers custom)
      const a = root.querySelector('#rel-cand-custom')?.value || '';
      const mun = root.querySelector('#rel-mun')?.value;
      const b = root.querySelector('#rel-cand-b-custom')?.value || '';
      if (a && b) {
        const [c, n] = a.split(':'); const [, n2] = b.split(':');
        spec.template = 'comparar'; spec.cargo = c; spec.a = n; spec.b = n2;
      } else if (a) {
        const [c, n] = a.split(':'); spec.template = 'candidato'; spec.cargo = c; spec.numero = n;
      } else if (mun) { spec.template = 'municipio'; spec.cd = mun; }
      else { spec.template = 'resumo'; }
    }
    return normalizeSpec(spec);
  }

  function syncModePanels(root) {
    const mode = (root.querySelector('input[name=rel-mode]:checked') || {}).value || 'resumo';
    root.querySelectorAll('.rel-mode-panel').forEach(p => { p.hidden = p.dataset.mode !== mode; });
    const blocks = root.querySelector('#rel-blocks');
    if (blocks) blocks.hidden = !(mode === 'custom' || mode === 'resumo');
  }

  function updateHashFromUI(root) {
    try {
      const spec = collectUISpec(root);
      const hash = buildRelHash(spec);
      if ((location.hash || '') !== hash) history.replaceState(null, '', hash);
      return spec;
    } catch (e) { console.warn('updateHashFromUI', e); return null; }
  }

  function onModeChange(root) {
    syncModePanels(root);
    const mode = (root.querySelector('input[name=rel-mode]:checked') || {}).value || 'resumo';
    // limpa campos de outros modelos para não vazar no custom/hash
    if (mode === 'resumo') {
      // ok
    } else if (mode === 'candidato') {
      const a = root.querySelector('#rel-cand-a'); const b = root.querySelector('#rel-cand-b');
      // mantém A como sugestão no #rel-cand se vazio
      const cand = root.querySelector('#rel-cand');
      if (cand && !cand.value && a && a.value) cand.value = a.value;
    }
    updateHashFromUI(root);
    refreshCandPhotos(root);
    const box = root.querySelector('#rel-preview');
    if (box) box.textContent = 'Modelo: ' + mode + '. Atualize a prévia ou gere o PDF.';
  }

  function applySpecToUI(root, spec) {
    if (!root || !spec) return;
    const s = normalizeSpec(spec);
    let mode = s.template || 'resumo';
    const radio = root.querySelector('input[name=rel-mode][value="' + mode + '"]');
    if (radio) radio.checked = true;
    syncModePanels(root);
    const cargo = s.cargo || s.c || '7';
    // limpa selects irrelevantes
    const setVal = (sel, v) => { const el = root.querySelector(sel); if (el) el.value = v || ''; };
    if (mode === 'comparar') {
      setVal('#rel-cand-a', s.a ? (cargo + ':' + s.a) : '');
      setVal('#rel-cand-b', s.b ? (cargo + ':' + s.b) : '');
    } else if (mode === 'candidato') {
      const n = s.numero || s.n;
      setVal('#rel-cand', n ? (cargo + ':' + n) : '');
    } else if (mode === 'municipio') {
      setVal('#rel-mun', s.cd || s.mun || '');
    }
    refreshCandPhotos(root);
    filterCandSelects(root);
  }

  function candMetaFromValue(val) {
    if (!val || !val.includes(':')) return null;
    const [cg, n] = val.split(':');
    const list = ((global.MAPA_INDEX || {}).cargos || {})[cg] || [];
    const c = list.find(x => String(x.n) === String(n));
    return { cargo: cg, numero: n, meta: c || { n, nm: n, nu: n, sg: '' } };
  }

  function refreshCandPhotos(root) {
    root.querySelectorAll('.rel-picker').forEach(picker => {
      const sel = picker.querySelector('select');
      const img = picker.querySelector('.rel-picker-photo');
      const fallback = picker.querySelector('.rel-picker-fallback');
      if (!sel || !img) return;
      const info = candMetaFromValue(sel.value);
      if (!info) {
        img.removeAttribute('src'); img.hidden = true;
        if (fallback) { fallback.hidden = false; fallback.textContent = '?'; }
        return;
      }
      const src = fotoPath(info.cargo, info.numero);
      img.onload = () => { img.hidden = false; if (fallback) fallback.hidden = true; };
      img.onerror = () => {
        img.hidden = true;
        if (fallback) {
          fallback.hidden = false;
          const nm = info.meta.nu || info.meta.nm || info.numero;
          const parts = String(nm).trim().split(/\s+/);
          fallback.textContent = parts.length < 2 ? String(nm).slice(0, 2).toUpperCase() : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        }
      };
      img.alt = info.meta.nu || info.meta.nm || info.numero;
      img.src = src;
    });
  }

  function filterCandSelects(root) {
    root.querySelectorAll('.rel-picker').forEach(picker => {
      const q = (picker.querySelector('.rel-picker-search')?.value || '').trim().toLowerCase();
      const sel = picker.querySelector('select');
      if (!sel) return;
      const cur = sel.value;
      for (const opt of sel.querySelectorAll('option')) {
        if (!opt.value) { opt.hidden = false; continue; }
        if (!q) { opt.hidden = false; continue; }
        const hay = (opt.textContent || '').toLowerCase() + ' ' + opt.value.toLowerCase();
        opt.hidden = !hay.includes(q);
      }
      for (const g of sel.querySelectorAll('optgroup')) {
        const any = [...g.querySelectorAll('option')].some(o => !o.hidden && o.value);
        g.hidden = q && !any;
      }
      // se filtro escondeu o atual, mantém valor mesmo hidden (não limpa)
      if (cur) sel.value = cur;
    });
  }

  function wireCandPickers(root) {
    root.querySelectorAll('.rel-picker').forEach(picker => {
      if (picker.dataset.wired) return;
      picker.dataset.wired = '1';
      const search = picker.querySelector('.rel-picker-search');
      const sel = picker.querySelector('select');
      if (search) search.addEventListener('input', () => filterCandSelects(root));
      if (sel) sel.addEventListener('change', () => {
        refreshCandPhotos(root);
        updateHashFromUI(root);
      });
    });
  }

  async function fillSelectors(root) {
    if (!global.MAPA_INDEX && typeof global.loadMapaIndex === 'function') {
      try { await global.loadMapaIndex(); } catch (e) { console.warn('loadMapaIndex', e); }
    }
    const preserved = {
      mode: (root.querySelector('input[name=rel-mode]:checked') || {}).value,
      cand: root.querySelector('#rel-cand')?.value || '',
      a: root.querySelector('#rel-cand-a')?.value || '',
      b: root.querySelector('#rel-cand-b')?.value || '',
      custom: root.querySelector('#rel-cand-custom')?.value || '',
      mun: root.querySelector('#rel-mun')?.value || '',
    };
    const opts = ['<option value="">Escolha…</option>'];
    for (const [cg, list] of Object.entries((global.MAPA_INDEX || {}).cargos || {})) {
      if (!['1', '3', '5', '6', '7'].includes(cg)) continue;
      const group = list.map(c => {
        const label = (c.nu || c.nm) + ' (' + c.n + ' · ' + (c.sg || '') + ')';
        return '<option value="' + cg + ':' + c.n + '" data-nm="' + String(c.nu || c.nm || '').replace(/"/g, '') + '" data-sg="' + String(c.sg || '') + '">' + label + '</option>';
      }).join('');
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

    // restaura seleção do usuário (não deixar o hash antigo sobrescrever após troca de modelo)
    const setIf = (sel, v) => {
      const el = root.querySelector(sel);
      if (!el || !v) return;
      if ([...el.options].some(o => o.value === v)) el.value = v;
    };
    if (preserved.mode) {
      const r = root.querySelector('input[name=rel-mode][value="' + preserved.mode + '"]');
      if (r) r.checked = true;
    }
    setIf('#rel-cand', preserved.cand);
    setIf('#rel-cand-a', preserved.a);
    setIf('#rel-cand-b', preserved.b);
    setIf('#rel-cand-custom', preserved.custom);
    setIf('#rel-mun', preserved.mun);
    syncModePanels(root);
    wireCandPickers(root);
    filterCandSelects(root);
    refreshCandPhotos(root);
  }

  function candCardHtml(tag, st, cargo, numero) {
    const rank = st.rank ? (st.rank + 'º de ' + st.total) : '—';
    const pr = st.partyRank ? (st.partyRank + 'º de ' + st.partyTotal) : '—';
    return '<article class="rel-cand-card">'
      + '<img class="rel-cand-photo" src="' + fotoPath(cargo, numero) + '" alt="" onerror="this.replaceWith(Object.assign(document.createElement(\'div\'),{className:\'rel-cand-photo rel-cand-fallback\',textContent:\'' + (st.nome || '?').slice(0, 2).toUpperCase().replace(/'/g, '') + '\'}))"/>'
      + '<div class="rel-cand-meta">'
      + '<div class="rel-cand-tag">' + tag + ' · nº ' + numero + (st.partido ? ' · ' + st.partido : '') + '</div>'
      + '<div class="rel-cand-name">' + st.nome + '</div>'
      + '<div>Votos: <strong>' + fmtN(st.vap) + '</strong>' + (st.pvap != null ? ' (' + fmtP(st.pvap) + ')' : '') + '</div>'
      + '<div>Ranking cargo: <strong>' + rank + '</strong></div>'
      + '<div>Ranking partido/fed.: <strong>' + pr + '</strong></div>'
      + '<div>Situação: <strong>' + (st.st || '—') + '</strong></div>'
      + '<div class="rel-cand-hist">2022: ' + histLine(st.hist) + '</div>'
      + '</div></article>';
  }

  function renderWebPreview(root, spec, built) {
    const box = root.querySelector('#rel-preview');
    if (!box) return;
    if (!built) { box.innerHTML = '<pre class="rel-preview-pre">Prévia:\n' + JSON.stringify(spec, null, 2) + '</pre>'; return; }

    if (spec.template === 'candidato' && built && built.kind === 'candidato') {
      const st = built.st;
      let html = '<div class="rel-preview-rich">';
      html += '<div class="rel-exec-cards">' + candCardHtml('Candidato', st, spec.cargo, built.numero) + '</div>';
      html += '<p class="meta">Prévia do relatório individual (PDF traz mapa + detalhe completo).</p>';
      html += '</div>';
      box.innerHTML = html;
      return;
    }

    if (spec.template === 'comparar' && spec.a && spec.b) {
      const { stA, stB, cmpRows, aByI, bByI, winByI, geojson, treeA, treeB, munNames } = built;
      const names = munNames || new Map();
      const svgA = buildChoroplethSVG(geojson, aByI, { w: 480, h: 360, title: 'A — ' + stA.nome + ' (quantis)', mode: 'seq', munNames: names });
      const svgB = buildChoroplethSVG(geojson, bByI, { w: 480, h: 360, title: 'B — ' + stB.nome + ' (quantis)', mode: 'seq', munNames: names });
      const svgC = buildChoroplethSVG(geojson, aByI, { w: 480, h: 360, title: 'Vencedor (intensidade = margem)', mode: 'win', winByI, aByI, bByI, munNames: names });
      const statsA = computeKeyStats(treeA, cmpRows, 'a');
      const statsB = computeKeyStats(treeB, cmpRows, 'b');
      const topLine = (stats, label) => {
        const top = (stats.top5 || []).map((m, i) => (i + 1) + '. ' + (names.get(m.i) || m.i) + ' (' + fmtN(m.v) + ')').join(' · ');
        return '<p class="rel-stats"><strong>' + label + '</strong>: ' + stats.munComVoto + ' mun. com voto · vence em '
          + stats.wins + ' · concentração top 3: ' + fmtP(stats.conc) + '<br/>Top 5: ' + top + '</p>';
      };
      let html = '<div class="rel-preview-rich">';
      html += '<div class="rel-exec-cards">' + candCardHtml('A', stA, spec.cargo, spec.a) + candCardHtml('B', stB, spec.cargo, spec.b) + '</div>';
      html += '<p>Δ A−B: <strong>' + fmtN(stA.vap - stB.vap) + '</strong></p>';
      html += topLine(statsA, 'A') + topLine(statsB, 'B');
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

    function pickerHtml(selId, label) {
      return [
        '<div class="rel-picker" data-picker="' + selId + '">',
        '<label class="rel-field">' + label + '</label>',
        '<div class="rel-picker-row">',
        '<div class="rel-picker-photo-wrap"><img class="rel-picker-photo" alt="" hidden/><div class="rel-picker-fallback" aria-hidden="true">?</div></div>',
        '<div class="rel-picker-controls">',
        '<input type="search" class="rel-picker-search" placeholder="Buscar nome, número ou partido…" aria-label="Buscar ' + label + '"/>',
        '<select id="' + selId + '" aria-label="' + label + '"></select>',
        '</div></div></div>'
      ].join('');
    }

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
        '<div class="rel-mode-panel" data-mode="candidato">' + pickerHtml('rel-cand', 'Candidato') + '</div>',
        '<div class="rel-mode-panel" data-mode="comparar" hidden>' + pickerHtml('rel-cand-a', 'Candidato A') + pickerHtml('rel-cand-b', 'Candidato B') + '</div>',
        '<div class="rel-mode-panel" data-mode="municipio" hidden><label class="rel-field">Município <select id="rel-mun"></select></label></div>',
        '<div class="rel-mode-panel" data-mode="custom" hidden>',
        '<p class="meta">Personalizado: escolha um candidato para relatório individual, ou use Resumo / Comparativo.</p>',
        pickerHtml('rel-cand-custom', 'Candidato'),
        '</div>',
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

      root.querySelectorAll('input[name=rel-mode]').forEach(r => r.addEventListener('change', () => onModeChange(root)));
      const munSel = root.querySelector('#rel-mun');
      if (munSel) munSel.addEventListener('change', () => updateHashFromUI(root));

      root.querySelector('#rel-preview-btn').addEventListener('click', async () => {
        const spec = collectUISpec(root);
        const box = root.querySelector('#rel-preview');
        box.textContent = 'Montando prévia…';
        try {
          history.replaceState(null, '', buildRelHash(spec));
          let built = null;
          if (spec.template === 'comparar' && spec.a && spec.b) {
            await ensureCargoEstado(spec.cargo);
            const geojson = await loadGeoMun();
            const geo = await loadGeoLoc();
            const treeA = buildVoteTree(geo, await loadCandFile(spec.cargo, spec.a) || { v: [] });
            const treeB = buildVoteTree(geo, await loadCandFile(spec.cargo, spec.b) || { v: [] });
            const munIdx = await loadMunIndex();
            const munNames = new Map((munIdx.muns || []).map(m => [m.i, m.nm]));
            const cmpRows = mergeCompareTrees(treeA, treeB, munNames);
            built = {
              stA: candState(spec.cargo, spec.a), stB: candState(spec.cargo, spec.b),
              cmpRows, treeA, treeB, geojson, munNames,
              aByI: new Map([...treeA.byI.entries()].map(([i, n]) => [i, n.v])),
              bByI: new Map([...treeB.byI.entries()].map(([i, n]) => [i, n.v])),
              winByI: new Map(cmpRows.map(r => [r.i, r.winner])),
            };
          } else if (spec.template === 'candidato' && (spec.numero || spec.n)) {
            await ensureCargoEstado(spec.cargo);
            const numero = spec.numero || spec.n;
            built = { kind: 'candidato', st: candState(spec.cargo, numero), numero };
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
        if (spec.template === 'candidato' && !(spec.numero || spec.n)) {
          root.querySelector('#rel-preview').textContent = 'Selecione um candidato.'; return;
        }
        if (spec.template === 'municipio' && !(spec.cd || spec.mun)) {
          root.querySelector('#rel-preview').textContent = 'Selecione um município.'; return;
        }
        btn.disabled = true;
        root.querySelector('#rel-preview').textContent = 'Gerando PDF…';
        try {
          const { filename } = await generateAndDownload(spec);
          root.querySelector('#rel-preview').textContent = 'PDF gerado: ' + filename + ' (modelo: ' + spec.template + ')';
          history.replaceState(null, '', buildRelHash(spec));
          root.querySelector('#rel-preview-btn').click();
        } catch (e) {
          console.error(e);
          root.querySelector('#rel-preview').textContent = 'Erro: ' + (e.message || e);
        } finally { btn.disabled = false; }
      });
    }

    const applyHash = !root.dataset.hashReady;
    const pending = applyHash ? parseRelHash() : null;
    fillSelectors(root).then(() => {
      if (pending) {
        applySpecToUI(root, pending);
        root.dataset.hashReady = '1';
      } else {
        updateHashFromUI(root);
      }
      wireCandPickers(root);
      refreshCandPhotos(root);
    }).catch(e => console.warn('fillSelectors', e));
    syncModePanels(root);
  }

  function applyHashFromLocation() {
    const hs = parseRelHash();
    if (!hs) return;
    const viewEl = document.getElementById('view-relatorios');
    const already = viewEl && viewEl.classList.contains('active');
    if (!already && typeof global.setView === 'function') global.setView('relatorios', false);
    const root = document.getElementById('grid-relatorios');
    if (root) {
      root.dataset.hashReady = ''; // força reaplicar este hash
      delete root.dataset.hashReady;
    }
    bootUI();
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
