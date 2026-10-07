/* Relatórios PDF + prévia web — jsPDF/autotable + mapas SE */
(function (global) {
  'use strict';

  const CARGO_NOME = { 1: 'Presidente', 3: 'Governador', 5: 'Senador', 6: 'Dep. Federal', 7: 'Dep. Estadual' };
  const BLOCKS = [
    { id: 'gov', label: 'Governador' }, { id: 'sen', label: 'Senado' },
    { id: 'pres', label: 'Presidente (no estado)' }, { id: 'fed', label: 'Dep. Federal' },
    { id: 'est', label: 'Dep. Estadual' }, { id: 'eleitos', label: 'Eleitos' },
    { id: 'alese', label: 'Cadeiras (Assembleia) / Senado' }, { id: 'hist', label: 'Histórico' },
    { id: 'meta', label: 'Meta do Senado' },
  ];

  let fontCache = null;
  let geoMunCache = null;
  let geoLocCache = null;
  function resetUfCaches() {
    geoLocCache = null; munIdxCache = null; secMetaCache = null; geoMunCache = null;
    if (typeof secCandCache !== 'undefined' && secCandCache.clear) secCandCache.clear();
  }
  window.RelatoriosResetUf = resetUfCaches;
  function mapaBaseRel() {
    return (typeof window !== 'undefined' && window.MAPA_BASE) ? window.MAPA_BASE : 'mapa';
  }
  function ufRel() { return String((typeof window !== 'undefined' && window.CURRENT_UF) || 'se').toLowerCase(); }
  function ufNomeRel() {
    const R = (typeof window !== 'undefined' && window.UF_REGISTRY) || {};
    return (R[ufRel()] && R[ufRel()].nome) || ({ se: 'Sergipe', al: 'Alagoas' })[ufRel()] || ufRel().toUpperCase();
  }

  /** "do Ceará", "da Bahia", "de Sergipe" / "no Ceará", "na Bahia", "em Sergipe" */
  function ufMetaRel() { const R = (typeof window !== 'undefined' && window.UF_REGISTRY) || {}; return R[ufRel()] || {}; }
  function ufDeRel() { return (ufMetaRel().prep || 'de') + ' ' + ufNomeRel(); }
  function ufEmRel() { return (ufMetaRel().em || 'em') + ' ' + ufNomeRel(); }

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
      ? (cargos.find(c => c.codigo === 1 && c.uf === ufRel()) || cargos.find(c => c.codigo === 1))
      : cargos.find(c => c.codigo === codigo && (!c.uf || c.uf === ufRel()));
    const key = global.chaveDe ? global.chaveDe(cargo || { codigo }) : ((cargo && cargo.chave) || codigo);
    const st = (global.estado && global.estado[key]) || {};
    return { cargo, dados: st.dados || null, key };
  }

  function histOf(codigo, numero) {
    const H = global.HIST;
    if (!H || !H.historico || ufRel() !== 'se') return null;
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
    // presidente: fotos/1 é nacional; demais cargos têm pasta por UF (SE na raiz, legado)
    const u = ufRel();
    const p = (u !== 'se' && String(cargo) !== '1') ? ('fotos/' + u + '/' + cargo + '/' + numero + '.jpg') : ('fotos/' + cargo + '/' + numero + '.jpg');
    return (global.dataUrl ? global.dataUrl(p) : p);
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
    const idx0 = await global.getJSON(mapaBaseRel() + '/index.json').catch(() => null);
    geoMunCache = await global.getJSON((idx0 && idx0.munGeo) || (ufRel() === 'se' ? 'mapa/se-mun.geojson' : mapaBaseRel() + '/' + ufRel() + '-mun.geojson'));
    return geoMunCache;
  }
  async function loadGeoLoc() {
    if (geoLocCache) return geoLocCache;
    const idx0 = await global.getJSON(mapaBaseRel() + '/index.json').catch(() => null);
    const gpath = (idx0 && idx0.geo) || (mapaBaseRel() + '/geo-se.json');
    geoLocCache = await global.getJSON(gpath);
    return geoLocCache;
  }
  async function loadMunIndex() {
    if (munIdxCache) return munIdxCache;
    munIdxCache = await global.getJSON(mapaBaseRel() + '/mun-index.json');
    return munIdxCache;
  }
  async function loadCandFile(cargo, numero) {
    try { return await global.getJSON(mapaBaseRel() + '/' + cargo + '/' + numero + '.json'); }
    catch { return null; }
  }

  /* ---------- Seções eleitorais (TSE votacao_secao + detalhe_votacao_secao 2026) ---------- */
  let secMetaCache = null;
  const secCandCache = new Map();
  async function loadSecaoMeta() {
    if (secMetaCache) return secMetaCache;
    secMetaCache = (async () => {
      const raw = await global.getJSON(mapaBaseRel() + '/secao/secoes.json');
      const byLoc = new Map();
      raw.s.forEach((r, i) => { let a = byLoc.get(r[0]); if (!a) { a = []; byLoc.set(r[0], a); } a.push(i); });
      for (const a of byLoc.values()) a.sort((x, y) => raw.s[x][1] - raw.s[y][1]);
      const pres = new Map((raw.pres || []).map(q => [q[0], [q[1], q[2]]]));
      return { s: raw.s, byLoc, pres, fonte: raw.fonte || '' };
    })();
    secMetaCache.catch(() => { secMetaCache = null; });
    return secMetaCache;
  }
  async function loadSecaoCand(cargo, numero) {
    const k = cargo + ':' + numero;
    if (!secCandCache.has(k)) {
      secCandCache.set(k, global.getJSON(mapaBaseRel() + '/secao/' + cargo + '/' + numero + '.json')
        .then(d => ({ t: d.t || 0, m: new Map(d.s || []), n: (d.s || []).length }))
        .catch(() => null));
    }
    return secCandCache.get(k);
  }
  function secInfo(meta, si, cargo) {
    const r = meta.s[si];
    let ap = r[2], cp = r[3];
    if (String(cargo) === '1' && meta.pres.has(si)) { const pp = meta.pres.get(si); ap = pp[0]; cp = pp[1]; }
    return { si, s: r[1], ap, cp, li: r[0] };
  }
  function escSecoes(meta, lis, cargo) {
    const out = [];
    for (const li of lis || []) for (const si of (meta.byLoc.get(li) || [])) out.push(secInfo(meta, si, cargo));
    out.sort((a, b) => a.s - b.s);
    return out;
  }
  function sumSecVotes(m) { let s = 0; for (const v of m.values()) s += v; return s; }
  function fmtPct1(part, whole) { return whole > 0 ? (100 * part / whole).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%' : '—'; }
  function eqCols(doc, ncols, indent) {
    const w = (pageSize(doc).w - margins().l - margins().r - (indent || 0)) / ncols;
    const cs = {}; for (let i = 0; i < ncols; i++) cs[i] = { cellWidth: w };
    return cs;
  }
  /** Linhas "empacotadas": `per` seções por linha, cada seção com cellsFn(s) células. */
  function packSecRows(secs, per, cellsFn, ncell) {
    const rows = [];
    for (let i = 0; i < secs.length; i += per) {
      const row = [];
      for (let j = 0; j < per; j++) {
        const s = secs[i + j];
        if (s) row.push(...cellsFn(s));
        else for (let k = 0; k < ncell; k++) row.push('');
      }
      rows.push(row);
    }
    return rows;
  }
  const SEC_HEAD_FILL = [51, 65, 85];
  const ESC_ROW_STYLE = { fillColor: [226, 232, 240], fontStyle: 'bold', textColor: [15, 23, 42], fontSize: 6.8 };
  const SEC_ROW_STYLE = { fontSize: 6.2, textColor: [51, 65, 85], cellPadding: { top: 1, bottom: 1, left: 2, right: 2 } };

  /** Candidato: escolas do bairro, cada uma com suas seções (Seção · Aptos · Comp. · Votos). */
  const BAIRRO_ROW_STYLE = { fillColor: [219, 234, 254], fontStyle: 'bold', textColor: [30, 58, 138], fontSize: 7 };
  function writeEscolasSecoesCand(doc, y, groups, ctx, indent) {
    const per = ctx.landscape ? 4 : 3, nc = 4, ncols = per * nc;
    const body = [];
    for (const g of groups) {
    body.push([{ content: g.title, colSpan: ncols, styles: BAIRRO_ROW_STYLE }]);
    for (const e of g.escolas) {
      const secs = escSecoes(ctx.meta, e.lis, ctx.cargo);
      let ap = 0, cp = 0, sv = 0;
      for (const s of secs) { ap += s.ap; cp += s.cp; s.v = ctx.votes.get(s.si) || 0; sv += s.v; }
      if (sv !== e.v) ctx.mismatch.push(e.nm + ': escola ' + e.v + ' ≠ seções ' + sv);
      body.push([
        { content: e.nl || '—', styles: ESC_ROW_STYLE },
        { content: e.nm + '  —  ' + secs.length + ' seç. · aptos ' + fmtN(ap) + ' · comp. ' + fmtN(cp), colSpan: ncols - 3, styles: ESC_ROW_STYLE },
        { content: fmtN(e.v) + ' (' + fmtPct1(e.v, cp) + ')', colSpan: 2, styles: Object.assign({}, ESC_ROW_STYLE, { halign: 'right' }) },
      ]);
      for (const r of packSecRows(secs, per, s => [
        { content: String(s.s), styles: { fontStyle: 'bold' } }, fmtN(s.ap), fmtN(s.cp),
        { content: fmtN(s.v), styles: { textColor: s.v ? [12, 74, 110] : [148, 163, 184], fontStyle: s.v ? 'bold' : 'normal' } },
      ], nc)) body.push(r.map(c => (typeof c === 'string' ? { content: c, styles: SEC_ROW_STYLE } : Object.assign({}, c, { styles: Object.assign({}, SEC_ROW_STYLE, c.styles) }))));
      ctx.rows += secs.length;
    }
    }
    const grp = []; for (let j = 0; j < per; j++) grp.push('Seção', 'Aptos', 'Comp.', 'Votos');
    return autoTable(doc, {
      startY: y,
      head: [[{ content: 'Nº local · Escola — seções · aptos · comparecimento', colSpan: ncols - 2 }, { content: 'Votos (% comp.)', colSpan: 2, styles: { halign: 'right' } }], grp],
      body,
      styles: { font: 'NotoSans', fontSize: 6.4, cellPadding: 1.6, halign: 'left', overflow: 'linebreak' },
      headStyles: { fillColor: SEC_HEAD_FILL, textColor: 255, fontSize: 6.4 },
      columnStyles: eqCols(doc, ncols, indent),
      margin: { left: margins().l + (indent || 0), right: margins().r },
    }) + 12;
  }

  /** Comparativo: escolas com seções (Seção · Aptos · Comp. · A · B · Δ). */
  function writeEscolasSecoesCmp(doc, y, groups, ctx, indent) {
    const per = ctx.landscape ? 3 : 2, nc = 6, ncols = per * nc;
    const body = [];
    for (const g of groups) {
    body.push([{ content: g.title, colSpan: ncols, styles: BAIRRO_ROW_STYLE }]);
    for (const e of g.escRows) {
      const secs = escSecoes(ctx.meta, e.lis, ctx.cargo);
      let ap = 0, cp = 0, sa = 0, sb = 0;
      for (const s of secs) {
        ap += s.ap; cp += s.cp;
        s.a = ctx.votesA.get(s.si) || 0; s.b = ctx.votesB.get(s.si) || 0; sa += s.a; sb += s.b;
      }
      if (sa !== e.va || sb !== e.vb) ctx.mismatch.push(e.nm + ': escola ' + e.va + '/' + e.vb + ' ≠ seções ' + sa + '/' + sb);
      const dStyle = Object.assign({}, ESC_ROW_STYLE, { textColor: e.d > 0 ? [21, 128, 61] : e.d < 0 ? [185, 28, 28] : [15, 23, 42] });
      body.push([
        { content: e.nl || '—', styles: ESC_ROW_STYLE },
        { content: e.nm + '  —  ' + secs.length + ' seç. · aptos ' + fmtN(ap) + ' · comp. ' + fmtN(cp), colSpan: ncols - 4, styles: ESC_ROW_STYLE },
        { content: fmtN(e.va), styles: ESC_ROW_STYLE }, { content: fmtN(e.vb), styles: ESC_ROW_STYLE },
        { content: (e.d > 0 ? '+' : '') + fmtN(e.d), styles: dStyle },
      ]);
      for (const r of packSecRows(secs, per, s => {
        const d = s.a - s.b;
        return [
          { content: String(s.s), styles: { fontStyle: 'bold' } }, fmtN(s.ap), fmtN(s.cp),
          { content: fmtN(s.a), styles: { textColor: [29, 78, 216] } },
          { content: fmtN(s.b), styles: { textColor: [194, 65, 12] } },
          { content: (d > 0 ? '+' : '') + fmtN(d), styles: { textColor: d > 0 ? [21, 128, 61] : d < 0 ? [185, 28, 28] : [100, 116, 139] } },
        ];
      }, nc)) body.push(r.map(c => (typeof c === 'string' ? { content: c, styles: SEC_ROW_STYLE } : Object.assign({}, c, { styles: Object.assign({}, SEC_ROW_STYLE, c.styles) }))));
      ctx.rows += secs.length;
    }
    }
    const grp = []; for (let j = 0; j < per; j++) grp.push('Seção', 'Aptos', 'Comp.', 'A', 'B', 'Δ');
    return autoTable(doc, {
      startY: y,
      head: [[{ content: 'Nº local · Escola — seções · aptos · comparecimento', colSpan: ncols - 3 }, 'A', 'B', 'Δ'], grp],
      body,
      styles: { font: 'NotoSans', fontSize: 6.2, cellPadding: 1.5, overflow: 'linebreak' },
      headStyles: { fillColor: SEC_HEAD_FILL, textColor: 255, fontSize: 6.4 },
      columnStyles: eqCols(doc, ncols, indent),
      margin: { left: margins().l + (indent || 0), right: margins().r },
    }) + 12;
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
        const cfg = (global.CONFIG.cargos || []).find(c => c.codigo === code && (!c.uf || c.uf === ufRel()));
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
      if (!esc) { esc = { nl: L.nl || '', nm: L.nm || ('Local ' + (L.nl || '')), v: 0, lis: [] }; bairro.escolas.set(eKey, esc); }
      esc.v += v;
      if (!esc.lis.includes(li)) esc.lis.push(li);
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

  /** Nome curto legível para rótulo (evita "SÃO", "NOSSA", "JABOATÃO" soltos). */
  function shortMunName(nm, max) {
    max = max || 16;
    const low = new Set(['DA', 'DE', 'DO', 'DAS', 'DOS', 'E']);
    let w = String(nm || '').replace(/NOSSA SENHORA/gi, 'N. Sra.').split(/\s+/).filter(Boolean)
      .map((x, i) => (i && low.has(x.toUpperCase())) ? x.toLowerCase() : (x.length <= 2 && x.endsWith('.')) ? x : x.charAt(0).toUpperCase() + x.slice(1).toLowerCase());
    let out = '';
    for (const x of w) { const t = out ? out + ' ' + x : x; if (t.length > max && out) break; out = t; }
    // não terminar em preposição
    out = out.replace(/\s(da|de|do|das|dos|e)$/i, '');
    return out.length > max + 2 ? out.slice(0, max) + '.' : out;
  }

  /** Posiciona rótulos top-N sem sobreposição: no centróide quando cabe; senão em coluna lateral com linha guia. */
  function layoutChoroLabels(cands, W, Hmap, colX, colSide, top) {
    let placed = [], side = [];
    const inter = (A, B) => !(A.x2 < B.x1 || A.x1 > B.x2 || A.y2 < B.y1 || A.y1 > B.y2);
    for (const L of cands.slice(0, top)) {
      const short = shortMunName(L.nm, 20);
      const num = fmtN(L.v);
      const w = Math.max(short.length * 4.9, num.length * 4.0) + 6;
      const b = { x1: L.x - w / 2, x2: L.x + w / 2, y1: L.y - 9, y2: L.y + 12 };
      if (b.x1 >= 2 && b.x2 <= W - 2 && b.y1 >= 2 && b.y2 <= Hmap && !placed.some(P => inter(P.b, b))) placed.push({ ...L, short, num, b });
      else side.push({ ...L, num });
    }
    // rótulo no centróide não pode cobrir o ponto nem a linha guia de um rótulo deslocado (cluster vai inteiro p/ coluna)
    let changed = true;
    while (changed && side.length) {
      changed = false;
      for (const P of placed.slice()) {
        const blocks = side.some(S => {
          const seg = { x1: Math.min(S.x, colX), x2: Math.max(S.x, colX), y1: S.y - 2, y2: S.y + 2 };
          return inter(P.b, { x1: S.x - 3, x2: S.x + 3, y1: S.y - 3, y2: S.y + 3 }) || inter(P.b, seg);
        });
        if (blocks) { placed = placed.filter(x => x !== P); side.push({ ...P }); changed = true; }
      }
    }
    side.forEach(S => { S.full = shortMunName(S.nm, 22); });
    // coluna lateral: ordena pela altura do ponto e empilha (22px por item)
    side.sort((a, b) => a.y - b.y);
    const ROW = 22; let lastY = -Infinity;
    for (const S of side) { const y = Math.max(S.y, lastY + ROW, 14); S.ly = y; lastY = y; }
    const over = lastY - (Hmap - 6);
    if (over > 0) side.forEach(S => { S.ly -= over; });
    side.forEach(S => { S.lx = colX; S.anchor = colSide === 'right' ? 'start' : 'end'; });
    return { placed, side };
  }

  function buildChoroplethSVG(geojson, valueByI, opts) {
    const W = (opts && opts.w) || 560, H = (opts && opts.h) || 420;
    const title = (opts && opts.title) || '';
    const mode = (opts && opts.mode) || 'seq'; // seq | win
    const munNames = (opts && opts.munNames) || null;
    const TOP = (opts && opts.topLabels) || 5;
    const legendH = mode === 'seq' ? 56 : 42;
    const bb = bboxOf(geojson);
    const ty = title ? 8 : 0;
    const Hmap = H - legendH;

    const vals = [];
    for (const f of geojson.features) vals.push(valueByI.get(f.properties.i) || 0);
    const { breaks, colors } = quantileBreaks(vals, 7);

    // 1ª passada: mapa em largura total; se algum rótulo colidir, reserva coluna lateral e reprojeta
    const COL = Math.min(110, Math.round(W * 0.2));
    const centroidsFor = (proj) => {
      const out = [];
      if (mode !== 'seq') return out;
      for (const f of geojson.features) {
        const v = valueByI.get(f.properties.i) || 0;
        if (v <= 0) continue;
        const c = featureCentroid(f, proj);
        if (c) out.push({ i: f.properties.i, v, nm: f.properties.nm || (munNames && munNames.get(f.properties.i)) || '', x: c[0], y: c[1] + ty });
      }
      return out.sort((a, b) => b.v - a.v);
    };
    let proj = projectFactory(bb, W, Hmap, 10);
    let lay = null;
    if (mode === 'seq') {
      let cands = centroidsFor(proj);
      lay = layoutChoroLabels(cands, W, Hmap + ty, W - 4, 'right', TOP);
      if (lay.side.length) {
        // lado da coluna = lado mais próximo dos rótulos deslocados (litoral costuma ser à direita)
        const avgX = lay.side.reduce((s, x) => s + x.x, 0) / lay.side.length;
        const right = avgX >= W / 2;
        const base = projectFactory(bb, W - COL, Hmap, 10);
        proj = right ? base : ((lon, lat) => { const r = base(lon, lat); return [r[0] + COL, r[1]]; });
        // extensão horizontal real do mapa (mapas "altos" ficam centralizados; a coluna encosta no mapa)
        const xa = proj(bb.minX, bb.minY)[0], xb = proj(bb.maxX, bb.maxY)[0];
        const mapMin = Math.min(xa, xb), mapMax = Math.max(xa, xb);
        const colX = right ? Math.min(W - COL + 8, mapMax + 14) : Math.max(COL - 8, mapMin - 14);
        cands = centroidsFor(proj);
        lay = layoutChoroLabels(cands, right ? colX - 4 : W, Hmap + ty, colX, right ? 'right' : 'left', TOP);
        if (!right) {
          const keep = [];
          for (const L of lay.placed) { if (L.b.x1 > colX + 4) keep.push(L); else lay.side.push({ ...L, full: shortMunName(L.nm, 22), lx: colX, anchor: 'end', ly: L.y }); }
          lay.placed = keep;
        }
      }
    }

    let paths = '';
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
    }

    let labels = '';
    if (lay) {
      const esc = (t) => String(t).replace(/[<>&"]/g, '');
      for (const L of lay.placed) {
        labels += `<g class="choro-lab">
          <text x="${L.x.toFixed(1)}" y="${(L.y - ty).toFixed(1)}" text-anchor="middle" font-size="8" font-weight="700" fill="#0f172a" stroke="#f8fafc" stroke-width="2.5" paint-order="stroke">${esc(L.short)}</text>
          <text x="${L.x.toFixed(1)}" y="${(L.y - ty + 9).toFixed(1)}" text-anchor="middle" font-size="7" fill="#334155" stroke="#f8fafc" stroke-width="2" paint-order="stroke">${L.num}</text>
        </g>`;
      }
      for (const S of lay.side) {
        const ax = S.x, ay = S.y - ty, ly = S.ly - ty;
        const tx = S.lx, elbow = S.anchor === 'start' ? tx - 4 : tx + 4;
        labels += `<g class="choro-lab choro-callout">
          <polyline points="${ax.toFixed(1)},${ay.toFixed(1)} ${elbow.toFixed(1)},${ly.toFixed(1)} ${tx.toFixed(1)},${ly.toFixed(1)}" fill="none" stroke="#334155" stroke-width="0.7"/>
          <circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="1.8" fill="#0f172a" stroke="#f8fafc" stroke-width="0.8"/>
          <text x="${(tx + (S.anchor === 'start' ? 2 : -2)).toFixed(1)}" y="${(ly - 1).toFixed(1)}" text-anchor="${S.anchor}" font-size="8" font-weight="700" fill="#0f172a" stroke="#f8fafc" stroke-width="2.5" paint-order="stroke">${esc(S.full)}</text>
          <text x="${(tx + (S.anchor === 'start' ? 2 : -2)).toFixed(1)}" y="${(ly + 8).toFixed(1)}" text-anchor="${S.anchor}" font-size="7" fill="#334155" stroke="#f8fafc" stroke-width="2" paint-order="stroke">${S.num}</text>
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
      <g transform="translate(0,${ty})">${paths}${labels}</g>
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
      doc.text('Cadê Meu Voto · cademeuvoto.com.br · Fonte: TSE — resultados oficiais 2026', 40, h - 22);
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

  /** NotoSans embutida não tem setas/✓: troca por ASCII para não sumir no PDF. */
  function pdfSafe(s) { return String(s || '').replace(/\s*→\s*/g, ' > ').replace(/≠/g, '<>'); }
  function bodyText(doc, text, y) {
    const m = margins();
    const { w, h } = pageSize(doc);
    doc.setFont('NotoSans', 'normal'); doc.setFontSize(10);
    const lines = doc.splitTextToSize(pdfSafe(text), w - m.l - m.r);
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
    // marca Cadê Meu Voto (desenhada em vetor)
    try {
      const lx = m.l, ly = 52, ls = 30, k = ls / 48;
      doc.setFillColor(37, 99, 235); doc.roundedRect(lx, ly, ls, ls, 12 * k, 12 * k, 'F');
      doc.setFillColor(248, 250, 252); doc.roundedRect(lx + 9 * k, ly + 9 * k, 30 * k, 14 * k, 3.5 * k, 3.5 * k, 'F');
      doc.setDrawColor(22, 163, 74); doc.setLineWidth(3.2 * k); doc.setLineCap('round'); doc.setLineJoin('round');
      doc.lines([[3.6 * k, 3.4 * k], [7.4 * k, -7.3 * k]], lx + 18 * k, ly + 16.3 * k, [1, 1], 'S', false);
      doc.setFillColor(219, 234, 254);
      for (const [kx, ky] of [[9, 27], [20, 27], [31, 27], [9, 34.5], [20, 34.5]]) doc.roundedRect(lx + kx * k, ly + ky * k, 8 * k, 5 * k, 1.6 * k, 1.6 * k, 'F');
      doc.setFillColor(34, 197, 94); doc.roundedRect(lx + 31 * k, ly + 34.5 * k, 8 * k, 5 * k, 1.6 * k, 1.6 * k, 'F');
      doc.setLineWidth(1); doc.setLineCap('butt'); doc.setDrawColor(0);
      doc.setFont('NotoSans', 'bold'); doc.setFontSize(16); doc.setTextColor(15, 23, 42);
      doc.text('Cadê Meu Voto', lx + ls + 10, ly + 14);
      doc.setFont('NotoSans', 'normal'); doc.setFontSize(9); doc.setTextColor(71, 85, 105);
      doc.text('cademeuvoto.com.br · dados oficiais do TSE até a seção eleitoral', lx + ls + 10, ly + 27);
    } catch (e) {}
    doc.setFont('NotoSans', 'bold'); doc.setFontSize(22); doc.setTextColor(15, 23, 42);
    doc.text('Eleições 2026 · ' + ufNomeRel(), m.l, 110);
    doc.setFontSize(15); doc.setTextColor(30, 64, 120);
    const lines = doc.splitTextToSize(title, w - m.l - m.r - ((photoUrls && photoUrls.length) ? 130 : 0));
    doc.text(lines, m.l, 135);
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
    const base = 135 + lines.length * 18 + 10;
    doc.text('Escopo: ' + scope, m.l, base);
    doc.text('Gerado em: ' + nowMaceio(), m.l, base + 18);
    doc.setFontSize(9); doc.setTextColor(90);
    doc.text(doc.splitTextToSize(pdfSafe(notes || 'Números oficiais do TSE. PDF gerado no navegador.'), w - m.l - m.r), m.l, h - 90);
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
    const scope = (CARGO_NOME[cargo] || cargo) + ' · nº ' + numero + (st.partido ? ' · ' + st.partido : '') + ' · ' + ufNomeRel();
    const wantSec = opts.secoes !== false;
    await writeCover(doc, title, scope, 'Foto local (repositório). Detalhamento completo município → zona → bairro → escola' + (wantSec ? ' → seção eleitoral.' : '.'), photo ? [photo] : []);

    const { tocPage, tocPageCount } = reserveTocPages(doc, 90);
    const bookmarks = [];
    doc.addPage(); let y = margins().t;
    const m0 = margins();
    const cardW0 = pageSize(doc).w - m0.l - m0.r;

    y = sectionTitle(doc, 'Resumo executivo', y, bookmarks, 'resumo', 150);
    y = writeCandCard(doc, m0.l, y, cardW0, st, photo, 'Candidato') + 20;

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

    let secCtx = null;
    if (wantSec) {
      try {
        const [meta, sc] = await Promise.all([loadSecaoMeta(), loadSecaoCand(cargo, numero)]);
        if (meta && sc) {
          secCtx = { meta, votes: sc.m, cargo, landscape: !!opts.landscape, mismatch: [], rows: 0 };
          const sSum = sumSecVotes(sc.m);
          const ok = sSum === tree.total;
          y = bodyText(doc, 'Conferência: soma das ' + fmtN(sc.n) + ' seções com voto = ' + fmtN(sSum) + ' votos; soma por escola/município = ' + fmtN(tree.total) + (ok ? ' (consistente).' : ' (DIVERGENTE).'), y);
        } else {
          y = bodyText(doc, 'Dados por seção indisponíveis para este candidato; detalhe até escola.', y);
        }
      } catch (e) {
        y = bodyText(doc, 'Dados por seção indisponíveis (' + (e.message || e) + '); detalhe até escola.', y);
      }
    }

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
        if (secCtx) {
          y = writeEscolasSecoesCand(doc, y, z.bairroList.map(b => ({ title: 'Bairro: ' + b.nm + ' — ' + fmtN(b.v) + ' votos', escolas: b.escolaList })), secCtx, 8);
          continue;
        }
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

    if (secCtx && secCtx.mismatch.length) console.warn('seções≠escola', secCtx.mismatch.slice(0, 5));
    writeToc(doc, bookmarks, tocPage, tocPageCount);
    addFooterAll(doc, { subtitle: title });
    doc.__secStats = secCtx ? { rows: secCtx.rows, mismatch: secCtx.mismatch.length } : null;
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
    const scope = (CARGO_NOME[cargo] || cargo) + ' · ' + aN + ' vs ' + bN + ' · ' + ufNomeRel();
    const wantSec = opts.secoes !== false;
    await writeCover(doc, title, scope, 'Comparativo zoneado completo (município → zona → bairro → escola' + (wantSec ? ' → seção' : '') + '). Fotos do repositório local.', [photoA, photoB].filter(Boolean));

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
    y = Math.max(yCardA, yCardB) + 20;
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

    let secCtx = null;
    if (wantSec) {
      try {
        const [meta, sa, sb] = await Promise.all([loadSecaoMeta(), loadSecaoCand(cargo, aN), loadSecaoCand(cargo, bN)]);
        if (meta && sa && sb) {
          secCtx = { meta, votesA: sa.m, votesB: sb.m, cargo, landscape: !!opts.landscape, mismatch: [], rows: 0 };
          const tA = sumSecVotes(sa.m), tB = sumSecVotes(sb.m);
          const ok = tA === treeA.total && tB === treeB.total;
          y = bodyText(doc, 'Conferência por seção: A = ' + fmtN(tA) + ' (escolas ' + fmtN(treeA.total) + ') · B = ' + fmtN(tB) + ' (escolas ' + fmtN(treeB.total) + ')' + (ok ? ' (consistente).' : ' (DIVERGENTE).'), y);
        } else {
          y = bodyText(doc, 'Dados por seção indisponíveis para A ou B; detalhe até escola.', y);
        }
      } catch (e) {
        y = bodyText(doc, 'Dados por seção indisponíveis (' + (e.message || e) + ').', y);
      }
    }

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
        const secGroups = [];
        for (const bnm of [...bairros].sort((a, b) => a.localeCompare(b, 'pt-BR'))) {
          const ba = za && za.bairros.get(bnm);
          const bb = zb && zb.bairros.get(bnm);
          const bvA = ba ? ba.v : 0, bvB = bb ? bb.v : 0;
          if (!secCtx && y > pageSize(doc).h - 70) { doc.addPage(); y = margins().t; }
          if (!secCtx) {
            doc.setFont('NotoSans', 'bold'); doc.setFontSize(8); doc.setTextColor(40, 60, 90);
            doc.text('Bairro: ' + bnm + ' — A ' + fmtN(bvA) + ' · B ' + fmtN(bvB) + ' · Δ ' + fmtN(bvA - bvB), margins().l + 6, y);
            y += 10; doc.setTextColor(0);
          }

          const escKeys = new Set([
            ...((ba && ba.escolaList) || []).map(e => e.nl + '|' + e.nm),
            ...((bb && bb.escolaList) || []).map(e => e.nl + '|' + e.nm),
          ]);
          const escMapA = new Map(((ba && ba.escolaList) || []).map(e => [e.nl + '|' + e.nm, e]));
          const escMapB = new Map(((bb && bb.escolaList) || []).map(e => [e.nl + '|' + e.nm, e]));
          // simple: rebuild sorted
          const escRows = [...escKeys].map(k => {
            const ea = escMapA.get(k), eb = escMapB.get(k);
            const nm = (ea || eb).nm, nl = (ea || eb).nl;
            const va = ea ? ea.v : 0, vb = eb ? eb.v : 0;
            const lis = [...new Set([...((ea && ea.lis) || []), ...((eb && eb.lis) || [])])];
            return { nl, nm, va, vb, d: va - vb, lis };
          }).sort((a, b) => (b.va + b.vb) - (a.va + a.vb) || a.nm.localeCompare(b.nm, 'pt-BR'));
          if (secCtx) { secGroups.push({ title: 'Bairro: ' + bnm + ' — A ' + fmtN(bvA) + ' · B ' + fmtN(bvB) + ' · Δ ' + ((bvA - bvB) > 0 ? '+' : '') + fmtN(bvA - bvB), escRows }); continue; }

          y = autoTable(doc, {
            startY: y,
            head: [['Nº', 'Escola / local', 'A', 'B', 'Δ']],
            body: escRows.map(e => [e.nl || '—', e.nm, fmtN(e.va), fmtN(e.vb), fmtN(e.d)]),
            styles: { font: 'NotoSans', fontSize: 6.5, cellPadding: 1.5 },
            headStyles: { fillColor: [51, 65, 85], textColor: 255, fontSize: 7 },
            margin: { left: margins().l + 6, right: margins().r },
          }) + 12;
        }
        if (secCtx && secGroups.length) y = writeEscolasSecoesCmp(doc, y, secGroups, secCtx, 6);
      }
    }

    if (secCtx && secCtx.mismatch.length) console.warn('seções≠escola', secCtx.mismatch.slice(0, 5));
    writeToc(doc, bookmarks, tocPage, tocPageCount);
    addFooterAll(doc, { subtitle: title });
    doc.__secStats = secCtx ? { rows: secCtx.rows, mismatch: secCtx.mismatch.length } : null;
    return { doc, stA, stB, treeA, treeB, cmpRows, aByI, bByI, winByI, geojson };
  }

  async function buildResumo(spec) {
    // keep lightweight resumo from before (simplified)
    const opts = Object.assign({ landscape: false, hist: true }, spec.options || {});
    const doc = newDoc(opts); await ensureFonts(doc);
    await writeCover(doc, 'Resumo da eleição — ' + ufNomeRel(), 'Estado ' + ufDeRel() + ' (' + ufRel().toUpperCase() + ')', null, []);
    doc.addPage(); const tocPage = doc.internal.getCurrentPageInfo().pageNumber;
    const bookmarks = []; doc.addPage(); let y = margins().t;
    const blocks = spec.blocks || ['gov', 'sen', 'pres', 'fed', 'est', 'eleitos'];
    function rowsFor(codigo, topN) {
      const { dados } = cargoDados(codigo);
      let list = sortedTodos(dados);
      if (topN) list = list.slice(0, topN);
      return list.map((k, i) => [String(i + 1), String(k.n), k.nome || '', k.partido || '', fmtN(k.vap), fmtP(k.pvap), k.eleito ? 'Eleito' : (k.st || '—')]);
    }
    for (const [id, cod, label, top] of [['gov', 3, 'Governador', 0], ['sen', 5, 'Senado', 0], ['pres', 1, 'Presidente ' + ufEmRel(), 0], ['fed', 6, 'Dep. Federal (top)', 8], ['est', 7, 'Dep. Estadual (top)', 24]]) {
      if (!blocks.includes(id)) continue;
      y = sectionTitle(doc, label, y, bookmarks);
      y = autoTable(doc, { startY: y, head: [['#', 'Nº', 'Nome', 'Partido', 'Votos', '%', 'Sit.']], body: rowsFor(cod, top), styles: { font: 'NotoSans', fontSize: 8 }, headStyles: { fillColor: [30, 64, 120], textColor: 255 }, margin: { left: margins().l, right: margins().r } }) + 10;
    }
    writeToc(doc, bookmarks, tocPage);
    addFooterAll(doc, { subtitle: 'Resumo da eleição — ' + ufNomeRel() });
    return { doc };
  }

  /** Município: zona → local de votação → seções (aptos, comparecimento, abstenção, 1º e 2º de Governador). */
  async function writeMunicipioSecoes(doc, y, mun, munData, bookmarks, opts) {
    const gov = ((munData && munData.cargos && munData.cargos['3']) || []).slice(0, 2);
    const [meta, geo] = await Promise.all([loadSecaoMeta(), loadGeoLoc()]);
    const vs = await Promise.all(gov.map(g => loadSecaoCand('3', g.n)));
    const locs = geo.loc || [];
    const zonas = new Map();
    let nSec = 0, ap = 0, cp = 0;
    const gSum = gov.map(() => 0);
    meta.s.forEach((r, si) => {
      const L = locs[r[0]];
      if (!L || L.m !== mun.i) return;
      let Z = zonas.get(L.z); if (!Z) { Z = new Map(); zonas.set(L.z, Z); }
      let E = Z.get(r[0]); if (!E) { E = { L, secs: [] }; Z.set(r[0], E); }
      const s = { s: r[1], ap: r[2], cp: r[3], g: vs.map(v => (v && v.m.get(si)) || 0) };
      s.g.forEach((v, i) => { gSum[i] += v; });
      E.secs.push(s); nSec++; ap += s.ap; cp += s.cp;
    });
    y = sectionTitle(doc, 'Seções eleitorais (' + fmtN(nSec) + ')', y, bookmarks, 'secoes', 120);
    const legend = gov.map((g, i) => 'G' + (i + 1) + ' = ' + g.n + ' ' + (g.nm || '') + (g.sg ? ' (' + g.sg + ')' : '')).join('   ·   ');
    y = bodyText(doc, 'Por local de votação: aptos, comparecimento e abstenção (TSE, detalhe por seção) e votos dos 2 mais votados para Governador no município. ' + legend, y);
    const checks = gov.map((g, i) => 'G' + (i + 1) + ': seções ' + fmtN(gSum[i]) + (gSum[i] === g.v ? ' = ' : ' ≠ ') + 'município ' + fmtN(g.v) + (gSum[i] === g.v ? ' (ok)' : ' (DIVERGENTE)'));
    y = bodyText(doc, 'Totais: ' + fmtN(nSec) + ' seções · aptos ' + fmtN(ap) + ' · comparecimento ' + fmtN(cp) + ' (' + fmtPct1(cp, ap) + ') · abstenção ' + fmtN(ap - cp) + '.  Conferência: ' + checks.join(' · '), y);
    const per = opts.landscape ? 3 : 2, nc = 6, ncols = per * nc;
    const gH = gov.map((g, i) => 'G' + (i + 1) + ' ' + g.n);
    while (gH.length < 2) gH.push('—');
    let rows = 0;
    for (const z of [...zonas.keys()].sort((a, b) => a - b)) {
      const Z = zonas.get(z);
      if (y > pageSize(doc).h - 90) { doc.addPage(); y = margins().t; }
      doc.setFont('NotoSans', 'bold'); doc.setFontSize(10); doc.setTextColor(0);
      doc.text('Zona ' + z, margins().l, y); y += 10;
      const escs = [...Z.values()].sort((a, b) => String(a.L.b || '').localeCompare(String(b.L.b || ''), 'pt-BR') || String(a.L.nm).localeCompare(String(b.L.nm), 'pt-BR'));
      const body = [];
      for (const E of escs) {
        E.secs.sort((a, b) => a.s - b.s);
        const eap = E.secs.reduce((s, x) => s + x.ap, 0), ecp = E.secs.reduce((s, x) => s + x.cp, 0);
        const eg = [0, 1].map(i => E.secs.reduce((s, x) => s + (x.g[i] || 0), 0));
        body.push([
          { content: E.L.nl || '—', styles: ESC_ROW_STYLE },
          { content: E.L.nm + (E.L.b ? ' · ' + E.L.b : '') + '  —  ' + E.secs.length + ' seç.', colSpan: ncols - 6, styles: ESC_ROW_STYLE },
          { content: fmtN(eap), styles: ESC_ROW_STYLE }, { content: fmtN(ecp) + ' (' + fmtPct1(ecp, eap) + ')', colSpan: 2, styles: ESC_ROW_STYLE },
          { content: gov[0] ? fmtN(eg[0]) : '—', styles: ESC_ROW_STYLE }, { content: gov[1] ? fmtN(eg[1]) : '—', styles: ESC_ROW_STYLE },
        ]);
        for (const r of packSecRows(E.secs, per, s => [
          { content: String(s.s), styles: { fontStyle: 'bold' } }, fmtN(s.ap), fmtN(s.cp), fmtN(s.ap - s.cp),
          { content: gov[0] ? fmtN(s.g[0]) : '—', styles: { textColor: [29, 78, 216] } },
          { content: gov[1] ? fmtN(s.g[1]) : '—', styles: { textColor: [194, 65, 12] } },
        ], nc)) body.push(r.map(c => (typeof c === 'string' ? { content: c, styles: SEC_ROW_STYLE } : Object.assign({}, c, { styles: Object.assign({}, SEC_ROW_STYLE, c.styles) }))));
        rows += E.secs.length;
      }
      const grp = []; for (let j = 0; j < per; j++) grp.push('Seção', 'Aptos', 'Comp.', 'Abst.', gH[0], gH[1]);
      y = autoTable(doc, {
        startY: y,
        head: [[{ content: 'Nº local · Local de votação · bairro', colSpan: ncols - 5 }, 'Aptos', { content: 'Comparec.', colSpan: 2 }, gH[0], gH[1]], grp],
        body,
        styles: { font: 'NotoSans', fontSize: 6.2, cellPadding: 1.5, overflow: 'linebreak' },
        headStyles: { fillColor: SEC_HEAD_FILL, textColor: 255, fontSize: 6.2 },
        columnStyles: eqCols(doc, ncols, 0),
        margin: { left: margins().l, right: margins().r },
      }) + 10;
    }
    doc.__secStats = { rows, mismatch: gov.filter((g, i) => gSum[i] !== g.v).length };
    return y;
  }

  async function buildMunicipio(spec) {
    const opts = Object.assign({ topN: 10, landscape: false }, spec.options || {});
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
      try { munData = await global.getJSON(mapaBaseRel() + '/mun/' + mun.cd + '.json'); } catch (_) {}
      for (const cg of ['3', '5', '1', '6', '7']) {
        const rows = (munData && munData.cargos && munData.cargos[cg]) || [];
        if (!rows.length) continue;
        y = sectionTitle(doc, CARGO_NOME[cg] || cg, y, bookmarks);
        y = autoTable(doc, { startY: y, head: [['#', 'Nº', 'Nome', 'Partido', 'Votos mun.', 'Total ' + ufRel().toUpperCase()]], body: rows.slice(0, opts.topN || 10).map((r, i) => [String(i + 1), String(r.n), r.nm || '', r.sg || '', fmtN(r.v), fmtN(r.t)]), styles: { font: 'NotoSans', fontSize: 8 }, headStyles: { fillColor: [30, 64, 120], textColor: 255 }, margin: { left: margins().l, right: margins().r } }) + 8;
      }
      if (opts.secoes !== false) {
        try { y = await writeMunicipioSecoes(doc, y, mun, munData, bookmarks, opts); }
        catch (e) { y = bodyText(doc, 'Seções indisponíveis: ' + (e.message || e), y); }
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
    const fname = safeFilename('relatorio_' + ufRel() + '_' + tag) + '.pdf';
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
    if (p.get('s') === '0') out.options = { secoes: false };
    if (out.template === 'comparativo') out.template = 'comparar';
    // só promove a comparar se o hash não pediu outro modelo explicitamente
    if ((out.a && out.b) && (out.template === 'resumo' || !p.get('t'))) out.template = 'comparar';
    return out;
  }

  function buildRelHash(spec) {
    const p = new URLSearchParams();
    let t = spec.template || 'resumo';
    if (t === 'comparativo') t = 'comparar';
    p.set('uf', ufRel());
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
    if (t !== 'resumo' && spec.options && spec.options.secoes === false) p.set('s', '0');
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
    const secEl = root.querySelector('#rel-secoes');
    const secoes = secEl ? !!secEl.checked : true;
    const blocks = [...root.querySelectorAll('.rel-block:checked')].map(x => x.value);
    const spec = { template: mode, options: { landscape, hist: true, fotos: true, secoes }, blocks };
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
    const sw = root.querySelector('#rel-secoes-wrap');
    if (sw) sw.hidden = mode === 'resumo';
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
    if (mode === 'candidato') {
      const a = root.querySelector('#rel-cand-a');
      const candPicker = root.querySelector('.rel-picker[data-picker="rel-cand"]');
      const cand = root.querySelector('#rel-cand');
      if (candPicker && cand && !cand.value && a && a.value) setPickerValue(candPicker, a.value, true);
    }
    updateHashFromUI(root);
    refreshCandPhotos(root);
    const box = root.querySelector('#rel-preview');
    if (box) box.innerHTML = '<p class="meta">Modelo: <strong>' + mode + '</strong>. Toque em “Atualizar prévia” para ver o relatório.</p>';
  }

  function applySpecToUI(root, spec) {
    if (!root || !spec) return;
    const s = normalizeSpec(spec);
    let mode = s.template || 'resumo';
    const radio = root.querySelector('input[name=rel-mode][value="' + mode + '"]');
    if (radio) radio.checked = true;
    syncModePanels(root);
    const secEl = root.querySelector('#rel-secoes');
    if (secEl) secEl.checked = !(s.options && s.options.secoes === false);
    const cargo = s.cargo || s.c || '7';
    const setP = (id, v) => {
      const picker = root.querySelector('.rel-picker[data-picker="' + id + '"]');
      if (picker) setPickerValue(picker, v || '', true);
    };
    if (mode === 'comparar') {
      setP('rel-cand-a', s.a ? (cargo + ':' + s.a) : '');
      setP('rel-cand-b', s.b ? (cargo + ':' + s.b) : '');
    } else if (mode === 'candidato') {
      const n = s.numero || s.n;
      setP('rel-cand', n ? (cargo + ':' + n) : '');
    } else if (mode === 'municipio') {
      const el = root.querySelector('#rel-mun'); if (el) el.value = s.cd || s.mun || '';
    }
    refreshCandPhotos(root);
  }

  let CAND_FLAT = []; // { value, cargo, n, nm, nu, sg, label, search }

  function rebuildCandFlat() {
    CAND_FLAT = [];
    for (const [cg, list] of Object.entries((global.MAPA_INDEX || {}).cargos || {})) {
      if (!['1', '3', '5', '6', '7'].includes(cg)) continue;
      for (const c of list) {
        const nm = c.nu || c.nm || '';
        const label = nm + ' (' + c.n + (c.sg ? ' · ' + c.sg : '') + ') · ' + (CARGO_NOME[cg] || cg);
        CAND_FLAT.push({
          value: cg + ':' + c.n,
          cargo: cg, n: String(c.n), nm: c.nm || '', nu: c.nu || nm, sg: c.sg || '',
          label,
          search: (nm + ' ' + (c.nm || '') + ' ' + c.n + ' ' + (c.sg || '') + ' ' + (CARGO_NOME[cg] || '')).toLowerCase(),
        });
      }
    }
  }

  function candMetaFromValue(val) {
    if (!val || !String(val).includes(':')) return null;
    const [cg, n] = String(val).split(':');
    const hit = CAND_FLAT.find(x => x.value === val) || null;
    if (hit) return { cargo: hit.cargo, numero: hit.n, meta: { n: hit.n, nm: hit.nm, nu: hit.nu, sg: hit.sg } };
    const list = ((global.MAPA_INDEX || {}).cargos || {})[cg] || [];
    const c = list.find(x => String(x.n) === String(n));
    return { cargo: cg, numero: n, meta: c || { n, nm: n, nu: n, sg: '' } };
  }

  function setPickerValue(picker, value, silent) {
    const hidden = picker.querySelector('input[type=hidden]');
    const input = picker.querySelector('.rel-picker-input');
    const chosen = picker.querySelector('.rel-picker-chosen');
    const menu = picker.querySelector('.rel-picker-menu');
    if (hidden) hidden.value = value || '';
    const info = candMetaFromValue(value);
    if (info) {
      const lab = (info.meta.nu || info.meta.nm || info.numero) + ' · ' + info.numero + (info.meta.sg ? ' · ' + info.meta.sg : '');
      if (input) input.value = lab;
      if (chosen) { chosen.hidden = false; chosen.textContent = 'Selecionado: ' + lab; }
    } else {
      if (input && !silent) { /* keep typed text while searching */ }
      if (!value && input) input.value = '';
      if (chosen) { chosen.hidden = true; chosen.textContent = ''; }
    }
    refreshOnePhoto(picker);
    if (menu) { menu.hidden = true; if (input) input.setAttribute('aria-expanded', 'false'); }
  }

  function refreshOnePhoto(picker) {
    const hidden = picker.querySelector('input[type=hidden]');
    const img = picker.querySelector('.rel-picker-photo');
    const fallback = picker.querySelector('.rel-picker-fallback');
    if (!img) return;
    const info = candMetaFromValue(hidden && hidden.value);
    const showFb = (txt) => {
      img.hidden = true;
      if (fallback) { fallback.hidden = false; fallback.textContent = txt || '?'; }
    };
    const showImg = () => {
      img.hidden = false;
      if (fallback) fallback.hidden = true;
    };
    if (!info) {
      img.removeAttribute('src');
      showFb('?');
      return;
    }
    const src = fotoPath(info.cargo, info.numero);
    const nm = info.meta.nu || info.meta.nm || info.numero;
    const parts = String(nm).trim().split(/\s+/);
    const ini = parts.length < 2 ? String(nm).slice(0, 2).toUpperCase() : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    img.onload = showImg;
    img.onerror = () => showFb(ini);
    img.alt = nm;
    // força recarregar mesmo se o src for igual (cache / onload não dispara)
    if (img.getAttribute('src') === src) img.removeAttribute('src');
    img.src = src;
    if (img.complete && img.naturalWidth > 0) showImg();
  }

  function refreshCandPhotos(root) {
    root.querySelectorAll('.rel-picker').forEach(refreshOnePhoto);
  }

  function filterCandQuery(q) {
    const qq = (q || '').trim().toLowerCase();
    if (!qq) return CAND_FLAT.slice(0, 10);
    const out = [];
    for (const c of CAND_FLAT) {
      if (c.search.includes(qq)) out.push(c);
      if (out.length >= 10) break;
    }
    return out;
  }

  function renderPickerMenu(picker, items, activeIdx) {
    const menu = picker.querySelector('.rel-picker-menu');
    const input = picker.querySelector('.rel-picker-input');
    if (!menu) return;
    if (!items.length) {
      menu.innerHTML = '<li class="rel-picker-empty" style="padding:10px;color:#94a3b8;font-size:0.85rem">Nenhum candidato</li>';
      menu.hidden = false;
      if (input) input.setAttribute('aria-expanded', 'true');
      return;
    }
    menu.innerHTML = items.map((c, i) => {
      const ini = (c.nu || c.nm || c.n).slice(0, 2).toUpperCase();
      return '<li role="option" id="' + picker.dataset.picker + '-opt-' + i + '" aria-selected="' + (i === activeIdx ? 'true' : 'false') + '">'
        + '<button type="button" class="rel-picker-item" data-value="' + c.value + '">'
        + '<img src="' + fotoPath(c.cargo, c.n) + '" alt="" onerror="this.replaceWith(Object.assign(document.createElement(\'div\'),{className:\'rel-picker-item-ph\',textContent:\'' + ini.replace(/'/g, '') + '\'}))"/>'
        + '<span class="rel-picker-item-meta"><span class="rel-picker-item-name">' + (c.nu || c.nm) + '</span>'
        + '<span class="rel-picker-item-sub">nº ' + c.n + (c.sg ? ' · ' + c.sg : '') + ' · ' + (CARGO_NOME[c.cargo] || c.cargo) + '</span></span>'
        + '</button></li>';
    }).join('');
    menu.hidden = false;
    if (input) input.setAttribute('aria-expanded', 'true');
    menu.querySelectorAll('.rel-picker-item').forEach(btn => {
      btn.addEventListener('mousedown', (ev) => {
        ev.preventDefault(); // keep focus
        setPickerValue(picker, btn.getAttribute('data-value'));
        const root = picker.closest('#grid-relatorios') || document;
        updateHashFromUI(root);
      });
    });
  }

  function wireCandPickers(root) {
    root.querySelectorAll('.rel-picker').forEach(picker => {
      if (picker.dataset.wired === '2') return;
      picker.dataset.wired = '2';
      const input = picker.querySelector('.rel-picker-input');
      const menu = picker.querySelector('.rel-picker-menu');
      if (!input || !menu) return;
      let activeIdx = 0;
      let items = [];

      const openWith = (q) => {
        items = filterCandQuery(q);
        activeIdx = 0;
        renderPickerMenu(picker, items, activeIdx);
      };

      input.addEventListener('focus', () => openWith(input.value));
      input.addEventListener('input', () => {
        // typing clears committed value until pick
        const hidden = picker.querySelector('input[type=hidden]');
        if (hidden) hidden.value = '';
        const chosen = picker.querySelector('.rel-picker-chosen');
        if (chosen) chosen.hidden = true;
        refreshOnePhoto(picker);
        openWith(input.value);
      });
      input.addEventListener('keydown', (ev) => {
        if (menu.hidden && (ev.key === 'ArrowDown' || ev.key === 'Enter')) {
          openWith(input.value); ev.preventDefault(); return;
        }
        if (menu.hidden) return;
        if (ev.key === 'ArrowDown') {
          ev.preventDefault(); activeIdx = Math.min(items.length - 1, activeIdx + 1);
          renderPickerMenu(picker, items, activeIdx);
        } else if (ev.key === 'ArrowUp') {
          ev.preventDefault(); activeIdx = Math.max(0, activeIdx - 1);
          renderPickerMenu(picker, items, activeIdx);
        } else if (ev.key === 'Enter') {
          ev.preventDefault();
          if (items[activeIdx]) {
            setPickerValue(picker, items[activeIdx].value);
            updateHashFromUI(root);
          }
        } else if (ev.key === 'Escape') {
          menu.hidden = true; input.setAttribute('aria-expanded', 'false');
        }
      });
      input.addEventListener('blur', () => {
        setTimeout(() => { menu.hidden = true; input.setAttribute('aria-expanded', 'false'); }, 150);
      });
    });
  }

  async function fillSelectors(root) {
    if (!global.MAPA_INDEX && typeof global.loadMapaIndex === 'function') {
      try { await global.loadMapaIndex(); } catch (e) { console.warn('loadMapaIndex', e); }
    }
    rebuildCandFlat();
    const idx = await loadMunIndex();
    // lê o estado da UI só depois do await: um hash novo aplicado nesse intervalo
    // (ex.: botão "Gerar PDF" do mapa) não pode ser sobrescrito pelos valores antigos
    const preserved = {
      mode: (root.querySelector('input[name=rel-mode]:checked') || {}).value,
      cand: root.querySelector('#rel-cand')?.value || '',
      a: root.querySelector('#rel-cand-a')?.value || '',
      b: root.querySelector('#rel-cand-b')?.value || '',
      custom: root.querySelector('#rel-cand-custom')?.value || '',
      mun: root.querySelector('#rel-mun')?.value || '',
    };
    const munHtml = ['<option value="">Escolha o município…</option>']
      .concat([...(idx.muns || [])].sort((a, b) => a.nm.localeCompare(b.nm, 'pt-BR')).map(m => '<option value="' + m.cd + '">' + m.nm + '</option>'))
      .join('');
    const mun = root.querySelector('#rel-mun'); if (mun) mun.innerHTML = munHtml;

    if (preserved.mode) {
      const r = root.querySelector('input[name=rel-mode][value="' + preserved.mode + '"]');
      if (r) r.checked = true;
    }
    const applyP = (id, v) => {
      const picker = root.querySelector('.rel-picker[data-picker="' + id + '"]');
      if (picker) setPickerValue(picker, v || '', true);
    };
    applyP('rel-cand', preserved.cand);
    applyP('rel-cand-a', preserved.a);
    applyP('rel-cand-b', preserved.b);
    applyP('rel-cand-custom', preserved.custom);
    if (mun && preserved.mun) {
      if ([...mun.options].some(o => o.value === preserved.mun)) mun.value = preserved.mun;
    }
    syncModePanels(root);
    wireCandPickers(root);
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
      + '<div class="rel-cand-hist">Histórico: ' + histLine(st.hist) + '</div>'
      + '</div></article>';
  }

  function revokePreviewUrls(box) {
    if (!box || !box._relBlobUrls) return;
    for (const u of box._relBlobUrls) { try { URL.revokeObjectURL(u); } catch (e) {} }
    box._relBlobUrls = [];
  }

  function htmlPreviewShell(title, bodyHtml, pdfUrl) {
    return '<div class="rel-preview-rich">'
      + '<h3 style="margin:0 0 8px;color:#7dd3fc">' + title + '</h3>'
      + bodyHtml
      + '<div class="rel-pdf-preview">'
      + '<div class="rel-pdf-actions">'
      + '<a class="btn-mapa" href="' + pdfUrl + '" download="previa-relatorio.pdf">Baixar PDF da prévia</a>'
      + '<a class="btn-mapa" href="' + pdfUrl + '" target="_blank" rel="noopener">Abrir PDF</a>'
      + '</div>'
      + '<div class="rel-pdf-frame-wrap">'
      + '<object class="rel-pdf-frame" data="' + pdfUrl + '#toolbar=1&navpanes=0" type="application/pdf" title="Prévia do PDF">'
      + '<iframe class="rel-pdf-frame" src="' + pdfUrl + '#toolbar=1" title="Prévia do PDF"></iframe>'
      + '</object>'
      + '</div>'
      + '<p class="meta">Se o PDF não aparecer no celular, use “Abrir PDF” ou “Baixar”. A prévia HTML acima resume o conteúdo.</p>'
      + '</div></div>';
  }

  async function buildHtmlSummary(spec) {
    const t = spec.template || 'resumo';
    if (t === 'comparar' && spec.a && spec.b) {
      await ensureCargoEstado(spec.cargo);
      const geojson = await loadGeoMun();
      const geo = await loadGeoLoc();
      const treeA = buildVoteTree(geo, await loadCandFile(spec.cargo, spec.a) || { v: [] });
      const treeB = buildVoteTree(geo, await loadCandFile(spec.cargo, spec.b) || { v: [] });
      const munIdx = await loadMunIndex();
      const munNames = new Map((munIdx.muns || []).map(m => [m.i, m.nm]));
      const cmpRows = mergeCompareTrees(treeA, treeB, munNames);
      const stA = candState(spec.cargo, spec.a), stB = candState(spec.cargo, spec.b);
      const aByI = new Map([...treeA.byI.entries()].map(([i, n]) => [i, n.v]));
      const bByI = new Map([...treeB.byI.entries()].map(([i, n]) => [i, n.v]));
      const winByI = new Map(cmpRows.map(r => [r.i, r.winner]));
      const svgA = buildChoroplethSVG(geojson, aByI, { w: 420, h: 320, title: 'A (quantis)', mode: 'seq', munNames });
      const svgB = buildChoroplethSVG(geojson, bByI, { w: 420, h: 320, title: 'B (quantis)', mode: 'seq', munNames });
      const svgC = buildChoroplethSVG(geojson, aByI, { w: 420, h: 320, title: 'Vencedor', mode: 'win', winByI, aByI, bByI, munNames });
      return '<div class="rel-exec-cards">' + candCardHtml('A', stA, spec.cargo, spec.a) + candCardHtml('B', stB, spec.cargo, spec.b) + '</div>'
        + '<p>Δ A−B: <strong>' + fmtN(stA.vap - stB.vap) + '</strong> · ' + cmpRows.length + ' municípios</p>'
        + '<div class="rel-maps">' + svgA + svgB + svgC + '</div>';
    }
    if (t === 'candidato' && (spec.numero || spec.n)) {
      await ensureCargoEstado(spec.cargo);
      const numero = spec.numero || spec.n;
      const st = candState(spec.cargo, numero);
      const geojson = await loadGeoMun();
      const geo = await loadGeoLoc();
      const tree = buildVoteTree(geo, await loadCandFile(spec.cargo, numero) || { v: [] });
      const valueByI = new Map([...tree.byI.entries()].map(([i, n]) => [i, n.v]));
      const munIdx = await loadMunIndex();
      const munNames = new Map((munIdx.muns || []).map(m => [m.i, m.nm]));
      const svg = buildChoroplethSVG(geojson, valueByI, { w: 480, h: 360, title: st.nome + ' (quantis)', mode: 'seq', munNames });
      return '<div class="rel-exec-cards">' + candCardHtml('Candidato', st, spec.cargo, numero) + '</div>'
        + '<div class="rel-maps">' + svg + '</div>'
        + '<p class="meta">PDF completo: mapa + município → zona → bairro → escola' + (spec.options && spec.options.secoes === false ? '' : ' → seção (aptos, comparecimento, votos)') + '.</p>';
    }
    if (t === 'municipio' && (spec.cd || spec.mun)) {
      const cd = spec.cd || spec.mun;
      const idx = await loadMunIndex();
      const mun = (idx.muns || []).find(m => String(m.cd) === String(cd));
      return '<p><strong>Município:</strong> ' + (mun ? mun.nm : cd) + ' <span class="meta">(código ' + cd + ')</span></p>'
        + '<p class="meta">O PDF lista os mais votados por cargo neste município' + (spec.options && spec.options.secoes === false ? '' : ' e todas as seções eleitorais por local de votação (aptos, comparecimento, abstenção, 1º e 2º para Governador)') + '.</p>';
    }
    // resumo
    await ensureCargoEstado(7);
    const { dados } = cargoDados(7);
    const top = sortedTodos(dados).slice(0, 8);
    let rows = top.map((k, i) => '<tr><td>' + (i + 1) + '</td><td>' + k.n + '</td><td>' + (k.nome || '') + '</td><td>' + (k.partido || '') + '</td><td>' + fmtN(k.vap) + '</td></tr>').join('');
    return '<p class="meta">Resumo da eleição ' + ufEmRel() + ' — amostra Dep. Estadual (top 8). O PDF traz os blocos marcados.</p>'
      + '<table class="rel-esc"><thead><tr><th>#</th><th>Nº</th><th>Nome</th><th>Partido</th><th>Votos</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  async function showVisualPreview(root, spec) {
    const box = root.querySelector('#rel-preview');
    if (!box) return;
    revokePreviewUrls(box);
    box._relBlobUrls = [];
    box.innerHTML = '<p class="meta">Gerando prévia visual…</p>';
    try {
      const s = normalizeSpec(spec);
      if (s.template === 'comparar' && (!s.a || !s.b)) {
        box.innerHTML = '<p class="meta">Selecione candidatos A e B para a prévia.</p>'; return;
      }
      if (s.template === 'candidato' && !(s.numero || s.n)) {
        box.innerHTML = '<p class="meta">Selecione um candidato (digite o nome na busca).</p>'; return;
      }
      if (s.template === 'municipio' && !(s.cd || s.mun)) {
        box.innerHTML = '<p class="meta">Selecione um município.</p>'; return;
      }
      const [htmlBody, doc] = await Promise.all([
        buildHtmlSummary(s),
        generate(s),
      ]);
      const blob = doc.output('blob');
      const url = URL.createObjectURL(blob);
      box._relBlobUrls.push(url);
      const titles = {
        comparar: 'Prévia — Comparativo',
        candidato: 'Prévia — Candidato',
        municipio: 'Prévia — Município',
        resumo: 'Prévia — Resumo',
        custom: 'Prévia — Personalizado',
      };
      box.innerHTML = htmlPreviewShell(titles[s.template] || 'Prévia', htmlBody, url);
    } catch (e) {
      console.error(e);
      box.innerHTML = '<p class="meta">Erro na prévia: ' + (e.message || e) + '</p>';
    }
  }

  function renderWebPreview(root, spec, built) {
    // legado — sempre preferir showVisualPreview
    showVisualPreview(root, spec);
  }

  function bootUI() {
    const root = document.getElementById('grid-relatorios');
    if (!root) return;

    function pickerHtml(selId, label) {
      return [
        '<div class="rel-picker" data-picker="' + selId + '">',
        '<label class="rel-field" for="' + selId + '-input">' + label + '</label>',
        '<div class="rel-picker-row">',
        '<div class="rel-picker-photo-wrap"><img class="rel-picker-photo" alt="" hidden/><div class="rel-picker-fallback" aria-hidden="true">?</div></div>',
        '<div class="rel-picker-controls" style="position:relative;flex:1;min-width:0">',
        '<input type="text" class="rel-picker-input" id="' + selId + '-input" autocomplete="off" spellcheck="false"',
        ' role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="' + selId + '-menu"',
        ' placeholder="Digite nome, número ou partido…" aria-label="Buscar ' + label + '"/>',
        '<input type="hidden" id="' + selId + '" value=""/>',
        '<ul class="rel-picker-menu" id="' + selId + '-menu" role="listbox" hidden></ul>',
        '<div class="rel-picker-chosen" hidden></div>',
        '</div></div></div>'
      ].join('');
    }

    if (!root.dataset.booted) {
      root.dataset.booted = '1';
      root.innerHTML = [
        '<section class="card span-all rel-card">',
        '<h2>Relatórios (PDF)</h2>',
        '<p class="meta">PDFs no navegador com mapas coropléticos <span class="rel-uf-de">' + ufDeRel() + '</span>, fotos e detalhe completo (município → zona → bairro → escola → seção eleitoral). Sumário clicável + favoritos.</p>',
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
        '<div class="rel-opts"><label><input type="checkbox" id="rel-landscape"> Paisagem</label>',
        '<label id="rel-secoes-wrap" hidden title="Tabelas por seção eleitoral sob cada escola (aumenta o nº de páginas)"><input type="checkbox" id="rel-secoes" checked> Incluir seções eleitorais</label></div>',
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
      const secChk = root.querySelector('#rel-secoes');
      if (secChk) secChk.addEventListener('change', () => updateHashFromUI(root));

      root.querySelector('#rel-preview-btn').addEventListener('click', async () => {
        const spec = collectUISpec(root);
        const box = root.querySelector('#rel-preview');
        box.textContent = 'Montando prévia…';
        try {
          history.replaceState(null, '', buildRelHash(spec));
          await showVisualPreview(root, spec);
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

    root.querySelectorAll('.rel-uf-nome').forEach(e => { e.textContent = ufNomeRel(); });
    root.querySelectorAll('.rel-uf-de').forEach(e => { e.textContent = ufDeRel(); });
    if (root.dataset.uf && root.dataset.uf !== ufRel()) {
      // trocou de UF: limpa seleção e prévia da UF anterior
      root.querySelectorAll('.rel-picker input').forEach(i => { i.value = ''; });
      root.querySelectorAll('.rel-picker-chosen').forEach(e => { e.hidden = true; e.innerHTML = ''; });
      const pv = root.querySelector('#rel-preview'); if (pv) pv.textContent = 'Escolha um modelo e atualize a prévia.';
    }
    root.dataset.uf = ufRel();
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
    loadSecaoMeta, loadSecaoCand,
  };

  function autoBoot() {
    if ((location.hash || '').replace(/^#/, '').startsWith('relatorios')) applyHashFromLocation();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoBoot);
  else autoBoot();
})(window);
