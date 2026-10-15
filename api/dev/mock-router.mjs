// Roteador de IA falso (OpenAI-compatível) para testes locais. Não chama nenhum modelo.
import http from 'node:http';
import fs from 'node:fs';
const port = Number(process.env.PORT || 8799);
http.createServer((req, res) => {
  let b = '';
  req.on('data', c => (b += c));
  req.on('end', () => {
    let body = {}; try { body = JSON.parse(b || '{}'); } catch {}
    const sys = (body.messages || [])[0]?.content || '';
    fs.writeFileSync(new URL('./last-system.txt', import.meta.url), sys);
    const plano = sys.includes('PLANO DO USUÁRIO: ASSINATURA') ? 'assinatura' : 'gratuito';
    const ret = sys.slice(sys.lastIndexOf('BLOCO_RETRIEVAL ('));
    const restrito = ret.includes('"restrito":true');
    const detalhe = /"detalhe":"(bairro|zona|local|local_exato)"/.test(ret);
    const reply = `[mock] plano=${plano} restrito=${restrito} detalhe=${detalhe}`;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ model: 'mock', choices: [{ message: { role: 'assistant', content: reply } }] }));
  });
}).listen(port, '127.0.0.1', () => console.log('mock router on', port));
