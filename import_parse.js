/* Bring-your-memory parser (PB-4): turns a pasted ChatGPT or Claude export
 * into one memory per line. Pure: no DOM, no network, no imports, so the
 * onboarding page runs it in the browser (a 50 MB conversations.json never
 * leaves the machine whole; only the extracted lines are sent) and
 * tests/test_onboarding_import.py runs it under node.
 *
 * Formats, detected in this order:
 *   chatgpt-conversations  ChatGPT data export conversations.json: an array of
 *                          { title, mapping: { id: { message: { author.role,
 *                          content.parts } } } }. Your own messages only, plus
 *                          custom instructions (content_type
 *                          "user_editable_context").
 *   claude-conversations   Claude data export conversations.json: an array of
 *                          { name, chat_messages: [{ sender, text | content }] }.
 *                          Your ("human") messages only.
 *   claude-memories        Claude data export memories.json: objects whose
 *                          string values hold the memory summary
 *                          (conversations_memory, project_memories).
 *   chatgpt-transcript     A conversation copied from the ChatGPT page
 *                          ("You said:" / "ChatGPT said:"). Your turns only.
 *   memory-list            The "export my memories" answer (the prompt Claude's
 *                          importer uses: section headers, "[YYYY-MM-DD] - …"
 *                          lines), ChatGPT's Manage-memories list, or any
 *                          Markdown/plain list. One line, one memory.
 *
 * Conversation formats are raw chat, not memories: the server runs each line
 * through the durability gate (api/index.ts /v1/import). Memory lists are
 * already memories and are stored as given. Assistant turns are never
 * imported: they are the other model's words, not the user's facts.
 */

export const MAX_ITEMS = 300;          // per import; the server takes them in batches
export const MAX_ITEM_CHARS = 2000;    // a longer line is a document, not a memory
const MIN_CHARS = 12;
const MIN_MESSAGE_CHARS = 25;          // "thanks!", "ok do it" are not memories

export const FORMAT_LABELS = {
  'chatgpt-conversations': 'ChatGPT data export (conversations.json)',
  'claude-conversations': 'Claude data export (conversations.json)',
  'claude-memories': 'Claude memory export (memories.json)',
  'chatgpt-transcript': 'Copied ChatGPT conversation',
  'memory-list': 'Memory list',
};

/** Formats whose lines are chat messages; the server gates each one. */
export const CONVERSATION_FORMATS = new Set(
  ['chatgpt-conversations', 'claude-conversations', 'chatgpt-transcript']);

/* Text that talks to the importing model instead of describing the user. It
 * would be stored as data and framed as untrusted on recall anyway; dropping
 * it here just keeps the memory clean. */
const DIRECTIVE = /\b(ignore|disregard|forget) (all |any )?(the )?(previous|prior|above|earlier) (instructions|messages|rules)|\bsystem prompt\b|\byou are now\b|<\/?(system|assistant|tool)>/i;

const BULLET = /^\s*(?:[-*•–+]|\d{1,3}[.)])\s+/;
const DATED = /^\[(\d{4}-\d{2}-\d{2}|unknown|undated)\]\s*[-–—:]?\s*/i;
const SECTION_TYPES = [
  [/instruction|preference|style|tone/i, 'preference'],
];

function clean(s) {
  return String(s).replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim();
}

function typeFor(section) {
  for (const [re, t] of SECTION_TYPES) if (section && re.test(section)) return t;
  return null;
}

/* A heading line: "## Career", "**Work context**", "2. **Identity**",
 * "Projects:". Returns its text or null. */
function heading(line) {
  let m = line.match(/^#{1,6}\s+(.+?)\s*#*$/);
  if (m) return m[1].replace(/\*\*/g, '').replace(/^\d+[.)]\s*/, '').trim();
  m = line.match(/^(?:\d{1,2}[.)]\s*)?\*\*([^*]{2,60})\*\*:?\s*$/);
  if (m) return m[1].trim();
  m = line.match(/^([A-Z][A-Za-z &/'-]{1,40}):$/);
  if (m) return m[1].trim();
  return null;
}

/* Long prose (Claude's memory summary is paragraphs) becomes sentence
 * groups of at most ~400 characters, so each memory stays one idea-sized. */
function splitProse(text) {
  if (text.length <= 400) return [text];
  const sentences = text.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) || [text];
  const out = [];
  let cur = '';
  for (const s of sentences.map((x) => x.trim()).filter(Boolean)) {
    if (cur && (cur + ' ' + s).length > 400) { out.push(cur); cur = s; }
    else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) out.push(cur);
  return out;
}

/* Only what is inside ``` fences, when the paste has any: the export prompt
 * asks for one code block, and the chatter around it ("This is the complete
 * set") is not memory. */
function unfence(text) {
  const blocks = [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  return blocks.length ? blocks.join('\n') : text;
}

function parseList(text, skipped) {
  const items = [];
  let section = null;
  for (const raw of unfence(text).split(/\r?\n/)) {
    let line = clean(raw);
    if (!line || /^```/.test(line) || /^[-=*_]{3,}$/.test(line)) continue;
    const h = heading(line);
    if (h) { section = h; continue; }
    line = line.replace(BULLET, '');
    let date = null;
    const d = line.match(DATED);
    if (d) {
      date = /^\d/.test(d[1]) ? d[1] : null;
      line = line.slice(d[0].length);
    }
    line = line.replace(/\*\*(.+?)\*\*/g, '$1').trim();
    for (const part of splitProse(line)) push(items, skipped, part, { date, section });
  }
  return items;
}

function push(items, skipped, content, extra = {}, minChars = MIN_CHARS) {
  const c = clean(content);
  if (c.length < minChars) { skipped.short++; return; }
  if (c.length > MAX_ITEM_CHARS) { skipped.long++; return; }
  if (DIRECTIVE.test(c)) { skipped.directive++; return; }
  items.push({ content: c, date: extra.date || null, section: extra.section || null,
               type: extra.type || typeFor(extra.section) });
}

const isoDay = (t) => {
  if (t == null || t === '') return null;
  const d = typeof t === 'number' ? new Date(t * 1000) : new Date(String(t));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

/* Chat messages: drop code-heavy and very long turns (a pasted log is not a
 * fact about you), keep the rest for the server's durability gate. */
function pushMessage(items, skipped, text, extra) {
  const t = clean(text);
  if (!t) return;
  if (t.includes('```') || t.length > MAX_ITEM_CHARS) { skipped.long++; return; }
  push(items, skipped, t, extra, MIN_MESSAGE_CHARS);
}

function parseChatGPT(convs, skipped) {
  const items = [];
  for (const c of convs) {
    const nodes = Object.values(c.mapping || {})
      .map((n) => n && n.message).filter(Boolean)
      .sort((a, b) => (a.create_time || 0) - (b.create_time || 0));
    for (const m of nodes) {
      const content = m.content || {};
      if (content.content_type === 'user_editable_context') {
        // Custom instructions: "About me" is the user's own memory, verbatim.
        for (const key of ['user_profile', 'user_instructions']) {
          if (typeof content[key] === 'string') {
            // The export wraps what the user typed in OpenAI's own preamble
            // and a ``` fence; only the fenced text is theirs.
            const fenced = content[key].match(/```([\s\S]*?)```/);
            for (const it of parseList(fenced ? fenced[1] : content[key], skipped)) {
              items.push({ ...it, section: 'Custom instructions', curated: true,
                           type: key === 'user_instructions' ? 'preference' : it.type });
            }
          }
        }
        continue;
      }
      if (!m.author || m.author.role !== 'user') continue;
      const parts = (content.parts || []).filter((p) => typeof p === 'string');
      pushMessage(items, skipped, parts.join('\n'),
        { date: isoDay(m.create_time ?? c.create_time), section: c.title || null });
    }
  }
  return items;
}

function parseClaude(convs, skipped) {
  const items = [];
  for (const c of convs) {
    for (const m of c.chat_messages || []) {
      if (m.sender !== 'human') continue;
      let text = typeof m.text === 'string' && m.text ? m.text : '';
      if (!text && Array.isArray(m.content)) {
        text = m.content.filter((p) => p && p.type === 'text' && typeof p.text === 'string')
          .map((p) => p.text).join('\n');
      }
      pushMessage(items, skipped, text,
        { date: isoDay(m.created_at ?? c.created_at), section: c.name || null });
    }
  }
  return items;
}

/* memories.json: every string under a key that names memory. */
function parseMemories(json, skipped) {
  const items = [];
  const walk = (v, key, depth) => {
    if (depth > 4 || v == null) return;
    if (typeof v === 'string') {
      if (/memor/i.test(key)) items.push(...parseList(v, skipped));
      return;
    }
    if (Array.isArray(v)) { v.forEach((x) => walk(x, key, depth + 1)); return; }
    if (typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        // project_memories is keyed by project uuid: inherit the parent key.
        walk(x, /memor/i.test(k) ? k : (/memor/i.test(key) ? key : k), depth + 1);
      }
    }
  };
  walk(json, '', 0);
  return items;
}

function parseTranscript(text, skipped) {
  const items = [];
  const turns = text.split(/^\s*(You said:|ChatGPT said:)\s*$/m);
  for (let i = 1; i < turns.length; i += 2) {
    if (turns[i] === 'You said:') pushMessage(items, skipped, turns[i + 1] || '', {});
  }
  return items;
}

function detectJson(text) {
  const t = text.trim();
  if (!/^[[{]/.test(t)) return null;
  try { return JSON.parse(t); } catch { return undefined; }
}

/** The POST /api/v1/import bodies for a parse, in order: at most `size`
 *  lines each (IMPORT_BATCH_MAX on the server). Lines the user curated
 *  themselves inside a chat export (ChatGPT custom instructions) go as a
 *  memory list, so the chat-turn durability gate does not drop them. */
export function importBatches(parsed, size = 20) {
  const out = [];
  const add = (format, items) => {
    for (let i = 0; i < items.length; i += size) out.push({ format, items: items.slice(i, i + size) });
  };
  const strip = ({ curated, ...it }) => it;
  add('memory-list', parsed.items.filter((it) => it.curated && parsed.format !== 'memory-list').map(strip));
  add(parsed.format, parsed.items.filter((it) => !it.curated || parsed.format === 'memory-list').map(strip));
  return out;
}

/** Parse a paste. Returns { format, items, skipped, truncated, error }. */
export function parseImport(text) {
  const skipped = { short: 0, long: 0, directive: 0, duplicate: 0 };
  let format = 'memory-list';
  let items = [];
  let error = null;
  const src = String(text || '');
  const json = detectJson(src);
  if (json === undefined) {
    error = 'This looks like JSON but does not parse. Paste the whole file, or a plain list.';
  } else if (json !== null) {
    const arr = Array.isArray(json) ? json : [json];
    const objs = arr.filter((x) => x && typeof x === 'object');
    if (objs.some((x) => x.mapping && typeof x.mapping === 'object')) {
      format = 'chatgpt-conversations'; items = parseChatGPT(objs, skipped);
    } else if (objs.some((x) => Array.isArray(x.chat_messages))) {
      format = 'claude-conversations'; items = parseClaude(objs, skipped);
    } else if (JSON.stringify(json).match(/"[^"]*memor[^"]*"\s*:/i)) {
      format = 'claude-memories'; items = parseMemories(json, skipped);
    } else if (arr.every((x) => typeof x === 'string')) {
      items = parseList(arr.join('\n'), skipped);
    } else {
      error = 'Unrecognised JSON. Supported: ChatGPT or Claude conversations.json, '
        + 'Claude memories.json, or a plain list of memories.';
    }
  } else if (/^\s*You said:\s*$/m.test(src) && /^\s*ChatGPT said:\s*$/m.test(src)) {
    format = 'chatgpt-transcript'; items = parseTranscript(src, skipped);
  } else {
    items = parseList(src, skipped);
  }

  // One memory per distinct line (case and spacing are not a different fact).
  const seen = new Set();
  items = items.filter((it) => {
    const k = it.content.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(k)) { skipped.duplicate++; return false; }
    seen.add(k); return true;
  });
  // Chats keep the most recent turns when there are too many.
  let truncated = 0;
  if (items.length > MAX_ITEMS) {
    truncated = items.length - MAX_ITEMS;
    items = CONVERSATION_FORMATS.has(format)
      ? items.sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, MAX_ITEMS)
      : items.slice(0, MAX_ITEMS);
  }
  return { format, items, skipped, truncated, error };
}
