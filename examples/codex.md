# OneBrain on Codex CLI

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

Production. Appends an `[mcp_servers.onebrain]` block to `~/.codex/config.toml` (`CODEX_HOME` when that is set). `bearer_token_env_var` is `ONEBRAIN_API_KEY`, so Codex sends `Authorization: Bearer` from that variable. The secret is not written into the file. Also sets `x-region` and `x-onebrain-host: codex`.

```bash
curl -fsSL https://onebrain.apxlbz.com/agent-install.sh | ONEBRAIN_API_KEY="$ONEBRAIN_API_KEY" bash -s -- codex
```

Dev:

```bash
curl -fsSL https://onebrain-dev.apxlbz.com/agent-install.sh | ONEBRAIN_API_KEY="$ONEBRAIN_API_KEY" bash -s -- codex
```

`codex-cli` is accepted as an alias of `codex`. Re-running replaces only the onebrain block.

Production MCP: `https://qlpfjeciekaqzribxlnp.supabase.co/functions/v1/mcp`
Production API base: `https://qlpfjeciekaqzribxlnp.supabase.co/functions/v1/api`

## Check

Start Codex from a shell where `ONEBRAIN_API_KEY` is set and call `recall` with any query. Empty results on a new memory are success.

## If it fails

- `ONEBRAIN_API_KEY is required` — export the variable and re-run. `ONEBRAIN_TOKEN` is the same key.
- `unknown host` — the last argument must be `codex`.
- `invalid TOML` — fix `config.toml` or move it aside, then re-run. The script will not overwrite a file it cannot parse.
- HTTP 401 — mint a new token on this project and export it. The previous token was replaced if you minted again.
- `Mint failed` — the bearer was the static key. Use `ONEBRAIN_SESSION_JWT`.
