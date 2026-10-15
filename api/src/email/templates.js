// Modelos de e-mail (pt-BR). Curtos, sem imagens, um link só (o domínio), sem propaganda.
const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MOTIVO = {
  login: 'para entrar no Cadê Meu Voto',
  cadastro: 'para confirmar seu cadastro no Cadê Meu Voto',
  excluir: 'para confirmar a EXCLUSÃO da sua conta no Cadê Meu Voto',
};

export function emailCodigo({ nome, codigo, finalidade = 'login', minutos = 10, site = 'https://cademeuvoto.com.br' }) {
  const ola = nome ? `Olá, ${String(nome).split(' ')[0]}!` : 'Olá!';
  const motivo = MOTIVO[finalidade] || MOTIVO.login;
  const subject = finalidade === 'excluir' ? `Código para excluir sua conta: ${codigo}` : `Seu código de acesso: ${codigo}`;
  const text = [
    ola, '',
    `Use o código abaixo ${motivo}:`, '',
    `    ${codigo}`, '',
    `Ele vale por ${minutos} minutos e só funciona uma vez.`,
    'Se não foi você, ignore este e-mail. Ninguém entra na sua conta sem este código.', '',
    'Cadê Meu Voto · resultados oficiais do TSE',
    site,
  ].join('\n');
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:24px 0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;padding:28px">
<tr><td style="font-size:18px;font-weight:bold;color:#1e3a8a;padding-bottom:16px">Cadê Meu Voto</td></tr>
<tr><td style="font-size:15px;line-height:1.5">${esc(ola)}<br>Use o código abaixo ${esc(motivo)}:</td></tr>
<tr><td align="center" style="padding:22px 0"><div style="display:inline-block;font-size:34px;letter-spacing:8px;font-weight:bold;font-family:'Courier New',monospace;background:#eef2ff;color:#1e3a8a;padding:12px 20px;border-radius:10px">${esc(codigo)}</div></td></tr>
<tr><td style="font-size:14px;line-height:1.5;color:#334155">Ele vale por ${minutos} minutos e só funciona uma vez.<br>Se não foi você, ignore este e-mail. Ninguém entra na sua conta sem este código.</td></tr>
<tr><td style="font-size:12px;color:#64748b;padding-top:22px;border-top:1px solid #e2e8f0;margin-top:22px">Cadê Meu Voto · resultados oficiais do TSE<br><a href="${esc(site)}" style="color:#1e40af">cademeuvoto.com.br</a></td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}
