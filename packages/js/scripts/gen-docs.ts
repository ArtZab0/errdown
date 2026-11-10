// Generates the GitHub Pages error reference (docs/errors/*.html) from the code's own tables,
// so the `type` URI of every Problem resolves to a page that matches the implementation.
import { mkdirSync, writeFileSync } from "node:fs";
import { CHALLENGES, PAGES } from "../src/fingerprints.ts";
import { classifyStatus, guidance } from "../src/status.ts";

const out = new URL("../../../docs/", import.meta.url).pathname;
mkdirSync(out + "errors", { recursive: true });

type Entry = { name: string; title: string; category: string; retryable: boolean; owner: boolean; statuses: Set<number>; sources: Set<string>; note?: string };
const entries = new Map<string, Entry>();
const add = (name: string, e: Omit<Entry, "name" | "statuses" | "sources">, status?: number, source?: string) => {
  const cur = entries.get(name) ?? { name, ...e, statuses: new Set(), sources: new Set() };
  if (status) cur.statuses.add(status);
  if (source && source !== "unknown") cur.sources.add(source);
  entries.set(name, cur);
};
const STATUSES = [...Array.from({ length: 200 }, (_, i) => 400 + i), 600];
for (const s of STATUSES) {
  const c = classifyStatus(s);
  add(c.error_name, { title: c.title, category: c.category, retryable: c.retryable, owner: c.owner_action_required }, s);
}
for (const fp of [...CHALLENGES, ...PAGES]) {
  if (!fp.error_name) continue;
  const challenge = CHALLENGES.includes(fp) && fp.category !== "access_denied";
  add(fp.error_name, {
    title: fp.title ?? fp.error_name, category: challenge ? "challenge" : (fp.category ?? "server_error"),
    retryable: challenge ? false : (fp.retryable ?? false), owner: fp.owner_action_required ?? false, note: fp.detail,
  }, fp.status?.[0], fp.source);
}
const sources = [...new Set([...CHALLENGES, ...PAGES].map((f) => f.source).filter((s) => s !== "unknown"))]
  .map((s) => s.replace(/-/g, "_")).sort((a, b) => b.length - a.length);

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const CSS = `:root{--bg:#fbfaf8;--fg:#1d1c1a;--muted:#6b6862;--line:#e4e1db;--accent:#b4441c;--code:#f1eee8}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#171614;--fg:#ece9e3;--muted:#a19d95;--line:#2e2c29;--accent:#f08a5d;--code:#22201d}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:720px;margin:0 auto;padding:48px 16px 80px}a{color:var(--accent)}h1{font-size:28px;line-height:1.25;margin:8px 0 16px}
.crumb{font-size:14px;color:var(--muted)}.crumb a{color:var(--muted)}code{font:14px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--code);padding:2px 5px;border-radius:4px}
dl{display:grid;grid-template-columns:max-content 1fr;gap:8px 20px;margin:24px 0;padding:16px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
dt{color:var(--muted);font-size:14px}dd{margin:0}h2{font-size:18px;margin:32px 0 8px}ul.list{padding:0;list-style:none;columns:2;column-gap:32px}ul.list li{break-inside:avoid;margin:2px 0}
footer{margin-top:48px;font-size:13px;color:var(--muted)}@media (max-width:560px){ul.list{columns:1}}`;
const page = (title: string, body: string, depth = 1) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><link rel="stylesheet" href="${"../".repeat(depth)}style.css"></head><body><main>${body}
<footer>errdown is independent and not affiliated with Cloudflare. <a href="https://github.com/ArtZab0/errdown">Source</a> · <a href="${"../".repeat(depth)}errors/">All errors</a></footer></main></body></html>\n`;

writeFileSync(out + "style.css", CSS + "\n");
const sorted = [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
for (const e of sorted) {
  const g = guidance({ error_category: e.category, retryable: e.retryable, owner_action_required: e.owner, retry_after: e.retryable ? undefined : undefined });
  const statuses = [...e.statuses].sort();
  writeFileSync(`${out}errors/${e.name}.html`, page(`${e.name} · errdown`, `
<div class="crumb"><a href="./">errdown errors</a> / <code>${e.name}</code></div>
<h1>${esc(e.title)}</h1>
<p>${esc(e.note ?? `An HTTP error that errdown classifies as <code>${e.name}</code>.`).replace(/&lt;code&gt;|&lt;\/code&gt;/g, (m) => (m.includes("/") ? "</code>" : "<code>"))}</p>
<dl><dt>error_name</dt><dd><code>${e.name}</code></dd>
<dt>error_category</dt><dd><code>${e.category}</code></dd>
<dt>retryable</dt><dd><code>${e.retryable}</code></dd>
<dt>owner_action_required</dt><dd><code>${e.owner}</code></dd>
${statuses.length ? `<dt>HTTP status</dt><dd>${statuses.slice(0, 12).join(", ")}${statuses.length > 12 ? ", …" : ""}</dd>` : ""}
${e.sources.size ? `<dt>Seen from</dt><dd>${[...e.sources].map(esc).join(", ")}</dd>` : ""}</dl>
<h2>What you should do</h2><p>${esc(g)}</p>
<p class="crumb">Names may carry a source prefix (for example <code>nginx_${e.name}</code>); they mean the same thing, produced by that server.</p>`));
}
// Source-prefixed names (e.g. nginx_bad_gateway) get real pages too, so agents that fetch the
// type URI without running JavaScript get a 200 with the right content.
const statusNames = [...new Set(STATUSES.map((st) => classifyStatus(st).error_name))];
let prefixed = 0;
for (const src of sources) {
  for (const base of statusNames) {
    const e = entries.get(base)!;
    const name = `${src}_${base}`;
    if (entries.has(name)) continue;
    const g = guidance({ error_category: e.category, retryable: e.retryable, owner_action_required: e.owner });
    writeFileSync(`${out}errors/${name}.html`, page(`${name} · errdown`, `
<div class="crumb"><a href="./">errdown errors</a> / <code>${name}</code></div>
<h1>${esc(e.title)} <span class="crumb">from ${esc(src.replace(/_/g, "-"))}</span></h1>
<p>A <code>${base}</code> error whose response was recognized as coming from <strong>${esc(src.replace(/_/g, "-"))}</strong>. See <a href="${base}">${base}</a>.</p>
<dl><dt>error_category</dt><dd><code>${e.category}</code></dd><dt>retryable</dt><dd><code>${e.retryable}</code></dd>
<dt>owner_action_required</dt><dd><code>${e.owner}</code></dd></dl>
<h2>What you should do</h2><p>${esc(g)}</p>`));
    prefixed++;
  }
}
console.log(`${prefixed} source-prefixed pages`);
writeFileSync(out + "errors/index.html", page("errdown error reference", `
<div class="crumb"><a href="../">errdown</a></div><h1>Error reference</h1>
<p>Every <code>type</code> URI in errdown output points here. Names with a server prefix (such as <code>nginx_bad_gateway</code>) resolve to the base entry.</p>
<ul class="list">${sorted.map((e) => `<li><a href="${e.name}">${e.name}</a></li>`).join("")}</ul>`));
writeFileSync(out + "index.html", page("errdown", `
<h1>errdown</h1><p>Cloudflare-compatible structured errors (RFC 9457) for every HTTP error your AI agent hits.</p>
<p><code>npm install errdown</code> · <code>pip install --pre errdown</code></p>
<p><a href="errors/">Error reference</a> · <a href="https://github.com/ArtZab0/errdown/blob/main/SPEC.md">Specification</a> · <a href="https://github.com/ArtZab0/errdown">GitHub</a></p>`, 0));
// 404 fallback: strip a known source prefix and redirect to the base entry.
writeFileSync(out + "404.html", page("Not found · errdown", `
<h1>Not found</h1><p id="msg">This page does not exist.</p>
<script>(function(){var m=location.pathname.match(/\\/errors\\/([a-z0-9_]+?)(?:\\.html)?\\/?$/);if(!m)return;
var known=${JSON.stringify(sorted.map((e) => e.name))},src=${JSON.stringify(sources)},n=m[1];
for(var i=0;i<src.length;i++){var p=src[i]+"_";if(n.indexOf(p)===0&&known.indexOf(n.slice(p.length))>=0){
location.replace(location.pathname.replace(/[^/]+\\/?$/,"")+n.slice(p.length)+"?source="+src[i]);return;}}
if(/^cloudflare_[0-9]+$/.test(n)){location.replace("https://developers.cloudflare.com/support/troubleshooting/http-status-codes/");return;}
document.getElementById("msg").textContent="Unknown errdown error name: "+n;})();</script>`, 0).replace(/href="style\.css"/, 'href="/errdown/style.css"').replace(/href="errors\/"/, 'href="/errdown/errors/"'));
writeFileSync(out + ".nojekyll", "");
console.log(`${sorted.length} error pages, ${sources.length} source prefixes`);
