// PATCHED (local): Claude plan usage meter for the web UI.
// Uses the Agent SDK's /usage control request, so the Claude CLI reads its own
// login credentials; this module never touches them.
import { query } from '@anthropic-ai/claude-agent-sdk';
import os from 'node:os';
const CACHE_MS = 60_000;
let cache = { at: 0, data: null };
let inFlight = null;
async function* never() { await new Promise(() => {}); }
async function fetchUsage() {
    const q = query({ prompt: never(), options: { cwd: os.homedir(), permissionMode: 'default', allowedTools: [], maxTurns: 1 } });
    try {
        const u = await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
        return { fetchedAt: new Date().toISOString(), subscription_type: u.subscription_type ?? null, rate_limits_available: u.rate_limits_available, rate_limits: u.rate_limits ?? null };
    } finally {
        // Only close. interrupt() after close rejects asynchronously and would
        // take the whole server down as an unhandled rejection.
        try { const r = q.close?.(); if (r && typeof r.catch === 'function') r.catch(() => {}); } catch { /* ignore */ }
    }
}
export async function getClaudeUsage(force = false) {
    if (!force && cache.data && Date.now() - cache.at < CACHE_MS) return { ...cache.data, cached: true };
    if (!inFlight) {
        inFlight = fetchUsage().then((data) => { cache = { at: Date.now(), data }; return data; }).finally(() => { inFlight = null; });
    }
    return inFlight;
}
if (process.argv[1] && process.argv[1].endsWith('claude-usage.patch.js')) {
    const t0 = Date.now();
    getClaudeUsage(true).then((d) => { console.log(JSON.stringify({ ms: Date.now() - t0, ...d }, null, 1)); process.exit(0); }, (e) => { console.error('ERR', e?.message); process.exit(1); });
}
