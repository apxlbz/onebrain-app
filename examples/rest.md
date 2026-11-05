# OneBrain over REST

No wizard. Mint one token, export `ONEBRAIN_API_KEY`, run one command. Use this when the agent does not speak MCP. OpenClaw can call these endpoints the same way.

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

Production. Writes `~/.config/onebrain/rest.env` (or under `$XDG_CONFIG_HOME`) with the API URL, MCP URL, and region. The key stays in the environment.

```bash
curl -fsSL https://onebrain.apxlbz.com/agent-install.sh | ONEBRAIN_API_KEY="$ONEBRAIN_API_KEY" bash -s -- rest
set -a; . ~/.config/onebrain/rest.env; set +a
```

Dev:

```bash
curl -fsSL https://onebrain-dev.apxlbz.com/agent-install.sh | ONEBRAIN_API_KEY="$ONEBRAIN_API_KEY" bash -s -- rest
```

Production API base: `https://qlpfjeciekaqzribxlnp.supabase.co/functions/v1/api`
Dev API base: `https://epjkzltwyfexiunbmbel.supabase.co/functions/v1/api`
Production MCP (if you switch to MCP later): `https://qlpfjeciekaqzribxlnp.supabase.co/functions/v1/mcp`

## Remember and recall

```bash
curl -fsS -X POST "$ONEBRAIN_API_URL/v1/remember" \
  -H "Authorization: Bearer $ONEBRAIN_API_KEY" \
  -H "Content-Type: application/json" \
  -H "x-region: $ONEBRAIN_REGION" \
  -d '{"content":"Decision: shared agent memory goes through OneBrain."}'

curl -fsS -X POST "$ONEBRAIN_API_URL/v1/recall" \
  -H "Authorization: Bearer $ONEBRAIN_API_KEY" \
  -H "Content-Type: application/json" \
  -H "x-region: $ONEBRAIN_REGION" \
  -d '{"query":"shared agent memory"}'
```

`POST /v1/forget` takes `{"id":["<id from recall>"]}`. `list_memory` is MCP-only.

The recall JSON also carries `handoff`, `briefing`, `superseded`, and `conflicts`. Read those fields: a superseded fact is not current, and a conflict is two current facts that disagree. `degraded` containing `signals` means they were not checked.

## If it fails

- HTTP 401 `Missing or invalid credentials` — set `ONEBRAIN_API_KEY` to a live `ob_` token for this API base. Mint: `POST $ONEBRAIN_API_URL/v1/me/token` with `Authorization: Bearer $ONEBRAIN_SESSION_JWT`.
- `Mint failed` — the bearer was the static key. Use the session JWT.
- `unknown host` — the install argument must be `rest`.
- `ONEBRAIN_API_KEY is required` — export it before running the installer. `ONEBRAIN_TOKEN` is the same key.
