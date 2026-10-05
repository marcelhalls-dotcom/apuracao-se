# apuracao-se-chat (Cloudflare Worker)

Backup do Worker do chat do painel. **Não** versionar secrets.

## Deploy
```bash
export CLOUDFLARE_API_TOKEN=…   # não commitar
export CLOUDFLARE_ACCOUNT_ID=640c5dffbaf852bac0e1a376c01c38f7
npm install
npx wrangler deploy
printf '%s' "$AI_ROUTER_API_KEY" | npx wrangler secret put AI_ROUTER_API_KEY
```

URL: https://apuracao-se-chat.chamado-640.workers.dev
