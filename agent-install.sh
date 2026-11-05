#!/usr/bin/env bash
# Wire OneBrain into one agent host. Idempotent: re-running rewrites only the
# `onebrain` entry and leaves every other server in the file alone.
#
#   curl -fsSL https://onebrain.apxlbz.com/agent-install.sh \
#     | ONEBRAIN_API_KEY="$ONEBRAIN_API_KEY" bash -s -- claude-code
#
# Hosts: claude-code, cursor, codex, mcp, rest.
#
# The key is required so a missing credential fails here, but it is NOT written
# into the host config. Each host reads ONEBRAIN_API_KEY from its environment
# (ONEBRAIN_TOKEN is accepted as a fallback name for the same value).
#
# The published copy of this file has https://qlpfjeciekaqzribxlnp.supabase.co/functions/v1/mcp / https://qlpfjeciekaqzribxlnp.supabase.co/functions/v1/api replaced with
# that site's project. From a git checkout those placeholders stay, and the
# defaults below are production. ONEBRAIN_URL (functions base, or a full /mcp
# or /api URL) overrides either.

if [ -z "${BASH_VERSION:-}" ]; then
  echo "agent-install.sh must be run with bash: curl … | bash -s -- <host>" >&2
  exit 1
fi
set -euo pipefail

# Filled in by the Pages sync for each environment. The comparisons below are
# split so that substitution cannot rewrite the check itself.
MCP_URL_DEFAULT="https://qlpfjeciekaqzribxlnp.supabase.co/functions/v1/mcp"
API_URL_DEFAULT="https://qlpfjeciekaqzribxlnp.supabase.co/functions/v1/api"
if [ "$MCP_URL_DEFAULT" = "__MCP""_URL__" ]; then
  MCP_URL_DEFAULT="https://qlpfjeciekaqzribxlnp.supabase.co/functions/v1/mcp"
fi
if [ "$API_URL_DEFAULT" = "__API""_URL__" ]; then
  API_URL_DEFAULT="https://qlpfjeciekaqzribxlnp.supabase.co/functions/v1/api"
fi

usage() {
  cat >&2 <<'EOF'
Usage: ONEBRAIN_API_KEY=ob_… bash agent-install.sh <host>

  claude-code   user-scope server in ~/.claude.json
  cursor        ~/.cursor/mcp.json
  codex         ~/.codex/config.toml
  mcp           ~/.config/onebrain/mcp.json (generic streamable HTTP)
  rest          ~/.config/onebrain/rest.env (URLs only)

The config references ONEBRAIN_API_KEY; it does not store the secret.
Export that variable in the environment that launches the host.
ONEBRAIN_TOKEN is accepted as another name for the same key.
Re-running replaces only the onebrain entry.

The last argument must be exactly one of: claude-code, cursor, codex, mcp, rest.
  curl -fsSL https://onebrain.apxlbz.com/agent-install.sh | ONEBRAIN_API_KEY="$ONEBRAIN_API_KEY" bash -s -- claude-code
Dev is the same command from https://onebrain-dev.apxlbz.com/agent-install.sh.
Agent docs: https://onebrain.apxlbz.com/llms.txt
EOF
  exit 2
}

if [ $# -ne 1 ]; then
  usage
fi

case "$1" in
  claude|claude-code) HOST="claude-code" ;;
  cursor) HOST="cursor" ;;
  codex|codex-cli) HOST="codex" ;;
  mcp|generic) HOST="mcp" ;;
  rest) HOST="rest" ;;
  -h|--help|help) usage ;;
  *)
    echo "unknown host: $1 — use exactly one of: claude-code, cursor, codex, mcp, rest." >&2
    usage
    ;;
esac

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required" >&2
  exit 1
fi

resolve_urls() {
  local mcp="$MCP_URL_DEFAULT"
  local api="$API_URL_DEFAULT"
  local base="${ONEBRAIN_URL:-}"
  base="${base%/}"
  if [ -n "$base" ]; then
    case "$base" in
      */mcp) mcp="$base"; api="${base%/mcp}/api" ;;
      */api) api="$base"; mcp="${base%/api}/mcp" ;;
      *) mcp="$base/mcp"; api="$base/api" ;;
    esac
  fi
  if [ -n "${ONEBRAIN_MCP_URL:-}" ]; then mcp="${ONEBRAIN_MCP_URL%/}"; fi
  if [ -n "${ONEBRAIN_API_URL:-}" ]; then api="${ONEBRAIN_API_URL%/}"; fi
  printf '%s\n%s\n' "$mcp" "$api"
}

{
  IFS= read -r MCP
  IFS= read -r API
} <<EOF
$(resolve_urls)
EOF

REGION="${ONEBRAIN_REGION:-ap-southeast-1}"

KEY="${ONEBRAIN_API_KEY:-${ONEBRAIN_TOKEN:-}}"
if [ -z "$KEY" ]; then
  cat >&2 <<EOF
ONEBRAIN_API_KEY is required (ONEBRAIN_TOKEN is the same key).
Export it in this process and re-run the same command.

Mint one with a signed-in session JWT. A static key cannot mint another
one. Minting again replaces the previous token. Read the JSON field token.

  ONEBRAIN_API_KEY=\$(curl -fsS -X POST "$API/v1/me/token" \\
    -H "Authorization: Bearer \$ONEBRAIN_SESSION_JWT" \\
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')

Browser, same project as that API: Settings → Connect your tools → Mint my token.
Production: https://onebrain.apxlbz.com
Dev: https://onebrain-dev.apxlbz.com
Agent docs: https://onebrain.apxlbz.com/llms.txt
EOF
  exit 1
fi
case "$KEY" in
  *[[:space:]]*)
    echo "ONEBRAIN_API_KEY must be a single token with no whitespace." >&2
    echo "Re-export it as ONEBRAIN_API_KEY='ob_…' with no spaces and no extra line, then re-run." >&2
    exit 1
    ;;
esac
unset KEY

# The key stays out of the Python process. Configs name the variable; they
# never receive the value.
env -u ONEBRAIN_API_KEY -u ONEBRAIN_TOKEN \
  python3 - "$HOST" "$MCP" "$API" "$REGION" "$HOME" "${CODEX_HOME:-}" "${XDG_CONFIG_HOME:-}" <<'PY'
import json
import os
import pathlib
import sys
import tomllib

host, mcp, api, region, home_s, codex_s, xdg_s = sys.argv[1:8]
home = pathlib.Path(home_s).expanduser()
codex_home = pathlib.Path(codex_s).expanduser() if codex_s else home / ".codex"
xdg = pathlib.Path(xdg_s).expanduser() if xdg_s else home / ".config"

def die(msg: str) -> None:
    print(msg, file=sys.stderr)
    raise SystemExit(1)

def check_url(label: str, url: str) -> None:
    if not (url.startswith("https://") or url.startswith("http://")):
        die(f"{label} is not an http(s) URL: {url}")
    if any(c in url for c in ' \t\r\n"\\'):
        die(f"{label} contains a character that would break the host config")

def check_region(value: str) -> None:
    if not value or any(c in value for c in ' \t\r\n"\\') or not all(
        ch.isalnum() or ch in "._-" for ch in value
    ):
        die(
            f"ONEBRAIN_REGION is not a single region token: {value!r}. "
            "Use a value like ap-southeast-1 (the default) with no spaces, then re-run."
        )

check_url("MCP URL", mcp)
check_url("API URL", api)
check_region(region)

AUTH = "Bearer ${ONEBRAIN_API_KEY}"
CURSOR_AUTH = "Bearer ${env:ONEBRAIN_API_KEY}"

def host_headers(auth: str) -> dict:
    # x-onebrain-host is the install target. The server records it as the
    # write's client. It is not a secret and not required for a write to succeed.
    return {"Authorization": auth, "x-region": region, "x-onebrain-host": host}

BEGIN = "# BEGIN onebrain agent-install"
END = "# END onebrain agent-install"

def dump_json(obj: object) -> str:
    return json.dumps(obj, indent=2) + "\n"

def write_if_changed(path: pathlib.Path, data: str) -> None:
    if path.is_dir():
        die(f"refusing to edit {path}: it is a directory")
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_text() == data:
        return
    mode = (path.stat().st_mode & 0o777) if path.exists() else 0o600
    tmp = path.with_name(path.name + ".onebrain-tmp")
    try:
        tmp.write_text(data)
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink()

def claude_entry() -> dict:
    return {
        "type": "http",
        "url": mcp,
        "headers": host_headers(AUTH),
    }

def cursor_entry() -> dict:
    return {
        "url": mcp,
        "headers": host_headers(CURSOR_AUTH),
    }

def generic_entry() -> dict:
    # Same shape Claude Code accepts (`type` is required there). Clients that
    # do not expand ${ONEBRAIN_API_KEY} need that variable's value in the header.
    return claude_entry()

def merge_mcp_json(path: pathlib.Path, entry: dict) -> None:
    if path.exists():
        if path.is_dir():
            die(f"refusing to edit {path}: it is a directory")
        try:
            doc = json.loads(path.read_text())
        except json.JSONDecodeError as exc:
            die(
                f"refusing to edit {path}: invalid JSON ({exc}). "
                "Fix that file or move it aside, then re-run this command. "
                "OneBrain does not overwrite a file it cannot parse."
            )
        if not isinstance(doc, dict):
            die(f"refusing to edit {path}: top-level JSON must be an object")
    else:
        doc = {}
    servers = doc.get("mcpServers", {})
    if not isinstance(servers, dict):
        die(f"refusing to edit {path}: mcpServers must be an object")
    servers["onebrain"] = entry
    doc["mcpServers"] = servers
    write_if_changed(path, dump_json(doc))

def is_onebrain_table(line: str) -> bool:
    s = line.strip()
    return s == "[mcp_servers.onebrain]" or s.startswith("[mcp_servers.onebrain.")

def strip_onebrain(text: str) -> str:
    lines = text.splitlines(keepends=True)
    out: list[str] = []
    i = 0
    while i < len(lines):
        stripped = lines[i].strip()
        if stripped == BEGIN:
            i += 1
            while i < len(lines) and lines[i].strip() != END:
                i += 1
            if i < len(lines) and lines[i].strip() == END:
                i += 1
            if i < len(lines) and lines[i] in ("\n", "\r\n"):
                i += 1
            continue
        if is_onebrain_table(lines[i]):
            i += 1
            while i < len(lines) and not (
                lines[i].lstrip().startswith("[") and not is_onebrain_table(lines[i])
            ):
                i += 1
            continue
        out.append(lines[i])
        i += 1
    return "".join(out)

def codex_block() -> str:
    return (
        f"{BEGIN}\n"
        "[mcp_servers.onebrain]\n"
        f'url = "{mcp}"\n'
        'bearer_token_env_var = "ONEBRAIN_API_KEY"\n'
        f'http_headers = {{ "x-region" = "{region}", "x-onebrain-host" = "{host}" }}\n'
        f"{END}\n"
    )

def merge_codex(path: pathlib.Path) -> None:
    existing = ""
    if path.exists():
        if path.is_dir():
            die(f"refusing to edit {path}: it is a directory")
        existing = path.read_text()
        try:
            tomllib.loads(existing or "")
        except tomllib.TOMLDecodeError as exc:
            die(
                f"refusing to edit {path}: invalid TOML ({exc}). "
                "Fix that file or move it aside, then re-run this command. "
                "OneBrain does not overwrite a file it cannot parse."
            )
    base = strip_onebrain(existing).rstrip()
    data = (base + "\n\n" + codex_block()) if base else codex_block()
    try:
        tomllib.loads(data)
    except tomllib.TOMLDecodeError as exc:
        die(f"refusing to write {path}: generated TOML is invalid ({exc})")
    write_if_changed(path, data)

def merge_rest(path: pathlib.Path) -> None:
    data = (
        f"ONEBRAIN_API_URL={api}\n"
        f"ONEBRAIN_MCP_URL={mcp}\n"
        f"ONEBRAIN_REGION={region}\n"
        f"ONEBRAIN_HOST={host}\n"
    )
    write_if_changed(path, data)

if host == "claude-code":
    path = home / ".claude.json"
    merge_mcp_json(path, claude_entry())
elif host == "cursor":
    path = home / ".cursor" / "mcp.json"
    merge_mcp_json(path, cursor_entry())
elif host == "codex":
    path = codex_home / "config.toml"
    merge_codex(path)
elif host == "mcp":
    path = xdg / "onebrain" / "mcp.json"
    merge_mcp_json(path, generic_entry())
elif host == "rest":
    path = xdg / "onebrain" / "rest.env"
    merge_rest(path)
else:
    die(
        f"unknown host: {host} — use exactly one of: "
        "claude-code, cursor, codex, mcp, rest."
    )

print(f"onebrain: wired {host} -> {path}", file=sys.stderr)
json.dump({
    "host": host,
    "path": str(path),
    "mcp_url": mcp,
    "api_url": api,
    "region": region,
    "auth": "env:ONEBRAIN_API_KEY",
}, sys.stdout, separators=(",", ":"))
sys.stdout.write("\n")
PY
