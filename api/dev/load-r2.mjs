// Carrega no R2 LOCAL (miniflare) os arquivos privados de algumas UFs, via rota dev /__dev/r2 (só existe com DEV_MODE=1).
import fs from 'node:fs';
const API = process.env.API || 'http://127.0.0.1:8787';
const UFS = (process.argv[2] || 'se,al,df').split(',');
const SPLIT = '/workspace/eleicoes-se/assinaturas/split';
const SRC = '/workspace/eleicoes-se/site';
const keyUf = k => { const m = k.match(/^mapa\/([a-z]{2})\//); return m && !/^\d/.test(m[1]) ? m[1] : 'se'; };
const lista = [
  ...fs.readFileSync(`${SPLIT}/manifestos/privado-copiar.txt`, 'utf8').split('\n').filter(Boolean).map(k => [k, `${SRC}/${k}`]),
  ...fs.readFileSync(`${SPLIT}/manifestos/privado-gerados.txt`, 'utf8').split('\n').filter(Boolean).map(k => [k, `${SPLIT}/out/privado/${k}`]),
].filter(([k]) => UFS.includes(keyUf(k)));
let ok = 0, fail = 0;
const fila = [...lista];
async function worker() {
  while (fila.length) {
    const [k, p] = fila.shift();
    const r = await fetch(`${API}/__dev/r2/${encodeURIComponent(k)}`, { method: 'PUT', headers: { Origin: 'http://localhost:8080' }, body: fs.readFileSync(p) });
    if (r.ok) ok++; else { fail++; if (fail < 5) console.error(k, r.status, await r.text()); }
  }
}
await Promise.all(Array.from({ length: 16 }, worker));
console.log(`R2 local: ${ok} arquivos carregados, ${fail} falhas (UFs ${UFS.join(',')})`);
