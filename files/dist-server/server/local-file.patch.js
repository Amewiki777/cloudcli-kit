// PATCHED (local): open local files from the chat UI (default app / chosen app / Finder / markdown preview).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { marked } from 'marked';
const CANDIDATE_APPS = ['Typora', 'TextEdit', 'Visual Studio Code', 'Cursor', 'Sublime Text', 'Obsidian', 'Zed', 'Xcode', 'BBEdit', 'MacDown', 'iA Writer', 'Nova', 'TextMate'];
const APP_DIRS = ['/Applications', '/System/Applications', path.join(os.homedir(), 'Applications')];
export function listApps() {
    const found = [];
    for (const name of CANDIDATE_APPS) {
        for (const dir of APP_DIRS) {
            if (fs.existsSync(path.join(dir, `${name}.app`))) { found.push(name); break; }
        }
    }
    return found;
}
function resolveTarget(raw) {
    if (typeof raw !== 'string' || !raw.trim()) throw Object.assign(new Error('path required'), { status: 400 });
    let p = raw.trim();
    if (p.startsWith('~/')) p = path.join(os.homedir(), p.slice(2));
    if (!path.isAbsolute(p)) throw Object.assign(new Error('path must be absolute'), { status: 400 });
    p = path.normalize(p);
    if (!fs.existsSync(p)) throw Object.assign(new Error('file not found: ' + p), { status: 404 });
    return p;
}
function run(args) {
    return new Promise((resolve, reject) => {
        execFile('/usr/bin/open', args, { timeout: 15000 }, (err, stdout, stderr) => err ? reject(new Error((stderr || err.message).trim())) : resolve((stdout || '').trim()));
    });
}
export async function openTarget({ path: raw, mode = 'default', app, dry }) {
    const target = resolveTarget(raw);
    let args;
    if (mode === 'reveal') args = ['-R', target];
    else if (mode === 'app') {
        if (!listApps().includes(app)) throw Object.assign(new Error('unknown app: ' + app), { status: 400 });
        args = ['-a', app, target];
    } else args = [target];
    if (dry) return { ok: true, dry: true, command: ['open', ...args] };
    await run(args);
    return { ok: true, command: ['open', ...args] };
}
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function renderPreview(raw) {
    const target = resolveTarget(raw);
    const stat = fs.statSync(target);
    if (!stat.isFile()) throw Object.assign(new Error('not a file'), { status: 400 });
    if (stat.size > 5 * 1024 * 1024) throw Object.assign(new Error('file too large for preview'), { status: 413 });
    const text = fs.readFileSync(target, 'utf8');
    const ext = path.extname(target).toLowerCase();
    const isMd = ext === '.md' || ext === '.markdown' || ext === '.mdx';
    const body = isMd ? marked.parse(text) : `<pre>${esc(text)}</pre>`;
    const name = path.basename(target);
    return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(name)}</title>
<style>:root{color-scheme:light dark}body{max-width:860px;margin:32px auto;padding:0 20px 60px;font:15px/1.7 -apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",sans-serif;color:#1f2937;background:#fff}
@media(prefers-color-scheme:dark){body{color:#e5e7eb;background:#111318}pre,code{background:#1f2329!important}a{color:#93c5fd}th,td{border-color:#374151!important}blockquote{border-color:#4b5563;color:#9ca3af}}
h1,h2,h3{line-height:1.3}pre{background:#f3f4f6;padding:12px 14px;border-radius:8px;overflow:auto;font-size:13px}code{background:#f3f4f6;padding:1px 5px;border-radius:4px;font-size:.92em}pre code{padding:0;background:none}
table{border-collapse:collapse;margin:12px 0}th,td{border:1px solid #d1d5db;padding:6px 10px}blockquote{margin:12px 0;padding:2px 14px;border-left:3px solid #d1d5db;color:#6b7280}img{max-width:100%}
.cu-top{font-size:12px;color:#6b7280;margin-bottom:18px;word-break:break-all}.cu-top a{color:inherit}</style></head>
<body><div class="cu-top">${esc(target)} · <a href="#" onclick="fetch('/api/local-file/open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:${JSON.stringify(target)},mode:'reveal'})});return false">在访达中显示</a></div>${body}</body></html>`;
}
