/* /install — public page. Primary path: mint a token, copy one
 * agent-install.sh line per host. The snippets further down carry only the
 * HTTP address for clients that sign in themselves. No token value is written
 * here. */
import { SUPA_ORIGIN } from "./env.js?v=1";

const MCP_URL = `${SUPA_ORIGIN}/functions/v1/mcp`;
const INSTALL_SH = location.hostname === "onebrain.apxlbz.com"
  ? "https://onebrain.apxlbz.com/agent-install.sh"
  : "https://onebrain-dev.apxlbz.com/agent-install.sh";
const INSTALL_HOSTS = [
  ["claude-code", "Claude Code"],
  ["cursor", "Cursor"],
  ["codex", "Codex"],
  ["mcp", "Any MCP client"],
  ["rest", "Plain REST"],
];

document.querySelectorAll("[data-mcp-url]").forEach((el) => { el.textContent = MCP_URL; });

const $ = (id) => document.getElementById(id);

const lines = document.getElementById("agent-lines");
if (lines) {
  lines.innerHTML = INSTALL_HOSTS.map(([host, label], i) => `
    <div class="client">
      <h2>${label}</h2>
      <div class="snip">
        <pre id="a-${i}" translate="no"></pre>
        <button type="button" class="copybtn" data-copy="a-${i}">Copy</button>
      </div>
    </div>`).join("");
  INSTALL_HOSTS.forEach(([host], i) => {
    document.getElementById(`a-${i}`).textContent =
      `curl -fsSL ${INSTALL_SH} | ONEBRAIN_API_KEY="$ONEBRAIN_API_KEY" bash -s -- ${host}`;
  });
}

$("s-code").textContent = `claude mcp add --scope user --transport http onebrain ${MCP_URL}`;
$("s-claude").textContent = MCP_URL;
$("s-cursor").textContent = JSON.stringify(
  { mcpServers: { onebrain: { url: MCP_URL } } }, null, 2);
$("s-vscode").textContent = JSON.stringify(
  { servers: { onebrain: { type: "http", url: MCP_URL } } }, null, 2);
$("s-windsurf").textContent = JSON.stringify(
  { mcpServers: { onebrain: { serverUrl: MCP_URL } } }, null, 2);
$("s-codex").textContent = `[mcp_servers.onebrain]\nurl = "${MCP_URL}"`;
$("s-zed").textContent = JSON.stringify(
  { context_servers: { onebrain: { source: "custom", url: MCP_URL } } }, null, 2);
$("s-gemini").textContent = `gemini mcp add --transport http onebrain ${MCP_URL}`;
$("s-other").textContent = MCP_URL;

$("link-cursor").href = "cursor://anysphere.cursor-deeplink/mcp/install?name=onebrain&config="
  + btoa(JSON.stringify({ url: MCP_URL }));
$("link-vscode").href = "vscode:mcp/install?" + encodeURIComponent(JSON.stringify(
  { name: "onebrain", type: "http", url: MCP_URL }));

document.querySelectorAll("[data-copy]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const text = $(btn.dataset.copy).textContent;
    try {
      await navigator.clipboard.writeText(text);
      const prior = btn.textContent;
      btn.textContent = "Copied";
      setTimeout(() => { btn.textContent = prior; }, 1500);
    } catch {
      btn.textContent = "Select & copy";
    }
  });
});
