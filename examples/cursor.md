# OneBrain on Cursor

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

Production. Writes `onebrain` in `~/.cursor/mcp.json` as an `npx mcp-remote` launch, and writes the key to `~/.config/onebrain/cursor-headers.txt` (mode 0600). The JSON stores the file path, not the key. `x-region` and `x-onebrain-host: cursor` are in that header file. A Dock launch reads the file; it does not need `ONEBRAIN_API_KEY` in the GUI environment.

```bash
curl -fsSL https://onebrain.apxlbz.com/agent-install.sh | ONEBRAIN_API_KEY="$ONEBRAIN_API_KEY" bash -s -- cursor
```

Dev:

```bash
curl -fsSL https://onebrain-dev.apxlbz.com/agent-install.sh | ONEBRAIN_API_KEY="$ONEBRAIN_API_KEY" bash -s -- cursor
```

`npx` must be on `PATH` in the shell that runs the command. The saved launch command is that `npx` binary, so opening Cursor from the Dock still starts the server with the header file.

Production MCP: `https://qlpfjeciekaqzribxlnp.supabase.co/functions/v1/mcp`
Production API base: `https://qlpfjeciekaqzribxlnp.supabase.co/functions/v1/api`

## Check

In a new Cursor chat, call `list_memory`. An empty memory is a successful connection.

## If it fails

- `ONEBRAIN_API_KEY is required` — export the variable in this shell and re-run. `ONEBRAIN_TOKEN` is the same key.
- `unknown host` — the last argument must be `cursor`.
- HTTP 401 `Missing or invalid credentials` — mint again against this same project. Dev tokens do not work on production.
- `Mint failed` — retry `POST /v1/me/token` with `ONEBRAIN_SESSION_JWT`, not the `ob_` key.
