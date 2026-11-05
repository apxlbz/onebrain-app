# OneBrain for any other MCP client

No wizard. Mint one token, export `ONEBRAIN_API_KEY`, run one command. Use this host for a client that is not Claude Code, Cursor, or Codex. OpenClaw is not its own host: use this file.

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

Production. Writes `~/.config/onebrain/mcp.json` (or `$XDG_CONFIG_HOME/onebrain/mcp.json`). Streamable HTTP, `type: http`, header `Authorization: Bearer ${ONEBRAIN_API_KEY}`, plus `x-region` and `x-onebrain-host: mcp`.

```bash
curl -fsSL https://onebrain.apxlbz.com/agent-install.sh | ONEBRAIN_API_KEY="$ONEBRAIN_API_KEY" bash -s -- mcp
```

Dev:

```bash
curl -fsSL https://onebrain-dev.apxlbz.com/agent-install.sh | ONEBRAIN_API_KEY="$ONEBRAIN_API_KEY" bash -s -- mcp
```

`generic` is accepted as an alias of `mcp`. A client that does not expand `${ONEBRAIN_API_KEY}` needs the key's value in that header. Point the client at the same URL.

Production MCP: `https://qlpfjeciekaqzribxlnp.supabase.co/functions/v1/mcp`
Dev MCP: `https://epjkzltwyfexiunbmbel.supabase.co/functions/v1/mcp`
Production API base: `https://qlpfjeciekaqzribxlnp.supabase.co/functions/v1/api`

## Check

`initialize`, then `tools/list`. Personal memory lists `recall`, `remember`, `forget`, `list_memory`.

## If it fails

- `ONEBRAIN_API_KEY is required` — export it and re-run. `ONEBRAIN_TOKEN` is the same key.
- `unknown host` — the last argument must be `mcp`.
- HTTP 401 `authorization required` / `Missing or invalid credentials` — the bearer is missing or not a live token for this project. Mint with `ONEBRAIN_SESSION_JWT` at `POST /v1/me/token` on this API base, then retry.
- `Mint failed` — you posted the `ob_` key. Post the session JWT instead.
