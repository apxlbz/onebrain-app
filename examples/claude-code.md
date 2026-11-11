# OneBrain on Claude Code

No wizard. Mint one token, export `ONEBRAIN_API_KEY`, run one command.

## Mint

Browser: https://onebrain.apxlbz.com → Settings → Connect your tools → Mint my token.

```bash
export ONEBRAIN_API_KEY='ob_…'
```

Session JWT already in `ONEBRAIN_SESSION_JWT` (a static key cannot mint; minting again replaces the previous token):

```bash
ONEBRAIN_API_KEY=$(curl -fsS -X POST \
  "https://qlpfjeciekaqzribxlnp.supabase.co/functions/v1/api/v1/me/token" \
  -H "Authorization: Bearer $ONEBRAIN_SESSION_JWT" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')
```

Dev mint URL: `https://epjkzltwyfexiunbmbel.supabase.co/functions/v1/api/v1/me/token`

## Install

Production. Writes the user-scope server `onebrain` in `~/.claude.json`. `type` is `http`. The header is `Authorization: Bearer ${ONEBRAIN_API_KEY}`. The secret is not written into the file. Also sets `x-region` and `x-onebrain-host: claude-code`.

```bash
curl -fsSL https://onebrain.apxlbz.com/agent-install.sh | ONEBRAIN_API_KEY="$ONEBRAIN_API_KEY" bash -s -- claude-code
```

Dev:

```bash
curl -fsSL https://onebrain-dev.apxlbz.com/agent-install.sh | ONEBRAIN_API_KEY="$ONEBRAIN_API_KEY" bash -s -- claude-code
```

`claude` is accepted as an alias of `claude-code`. Export `ONEBRAIN_API_KEY` in the environment that launches Claude Code.

Production MCP: `https://qlpfjeciekaqzribxlnp.supabase.co/functions/v1/mcp`
Production API base: `https://qlpfjeciekaqzribxlnp.supabase.co/functions/v1/api`

## Google sign-in, without a token

The API-key command above is the one to use. Without a token, connect before login:

```bash
claude mcp add --scope user --transport http onebrain https://qlpfjeciekaqzribxlnp.supabase.co/functions/v1/mcp
claude mcp get onebrain
claude mcp login onebrain
```

`claude mcp get onebrain` (or `/mcp` in a session) caches the metadata URL from the 401 `WWW-Authenticate` header. A fresh `claude mcp login` before that stops with no authorization URL. Dev puts `https://epjkzltwyfexiunbmbel.supabase.co/functions/v1/mcp` in the `mcp add` line.

## Check

Ask Claude Code to `remember` one sentence, then `recall` it. Tools: `recall`, `remember`, `forget`, `list_memory`.

## If it fails

- `ONEBRAIN_API_KEY is required` — export the variable in this shell and re-run. `ONEBRAIN_TOKEN` is the same key.
- `unknown host` — the last argument must be `claude-code`.
- HTTP 401 `Missing or invalid credentials` — mint again. The old token stops working when you mint.
- `Mint failed` — the POST used the `ob_` key. Retry with `ONEBRAIN_SESSION_JWT`.
