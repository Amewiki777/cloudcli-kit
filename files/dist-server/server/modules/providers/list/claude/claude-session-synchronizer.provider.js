// PATCHED (local): title priority = Claude custom-title > ai-title > first real prompt.
// Original kept as *.orig. Only Claude sessions are indexed.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';
import { readFile } from 'node:fs/promises';
import { sessionsDb } from '../../../../modules/database/index.js';
import { extractFirstValidJsonlData, findFilesRecursivelyCreatedAfter, normalizeSessionName, readFileTimestamps, } from '../../../../shared/utils.js';
const isMeaningfulPrompt = (text) => {
    const t = typeof text === 'string' ? text.trim() : '';
    return t.length > 0 && !t.startsWith('/') && !t.startsWith('<');
};
const textOfUserMessage = (message) => {
    if (!message || message.role !== 'user') return undefined;
    const c = message.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) {
        for (const block of c) {
            if (block && block.type === 'text' && typeof block.text === 'string') return block.text;
        }
    }
    return undefined;
};
async function buildFirstPromptMap(filePath) {
    const lookup = new Map();
    lookup.interactiveIds = new Set();
    try {
        const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
        for await (const line of rl) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            let parsed;
            try { parsed = JSON.parse(trimmed); } catch { continue; }
            const key = parsed.sessionId;
            const value = parsed.display;
            if (typeof key === 'string') lookup.interactiveIds.add(key);
            if (typeof key === 'string' && isMeaningfulPrompt(value) && !lookup.has(key)) {
                lookup.set(key, value.trim());
            }
        }
    } catch { /* history.jsonl missing */ }
    return lookup;
}
export class ClaudeSessionSynchronizer {
    provider = 'claude';
    claudeHome = path.join(os.homedir(), '.claude');
    isSubagentTranscript(filePath) {
        const pathParts = path.normalize(filePath).split(path.sep);
        return pathParts.includes('subagents') || pathParts.includes('tool-results');
    }
    async synchronize(since) {
        const nameMap = await buildFirstPromptMap(path.join(this.claudeHome, 'history.jsonl'));
        const files = await findFilesRecursivelyCreatedAfter(path.join(this.claudeHome, 'projects'), '.jsonl', since ?? null);
        let processed = 0;
        for (const filePath of files) {
            if (this.isSubagentTranscript(filePath)) continue;
            const parsed = await this.processSessionFile(filePath, nameMap);
            if (!parsed) continue;
            const timestamps = await readFileTimestamps(filePath);
            sessionsDb.createSession(parsed.sessionId, this.provider, parsed.projectPath, parsed.sessionName, timestamps.createdAt, timestamps.updatedAt, filePath);
            processed += 1;
        }
        return processed;
    }
    async synchronizeFile(filePath) {
        if (!filePath.endsWith('.jsonl')) return null;
        if (this.isSubagentTranscript(filePath)) return null;
        const nameMap = await buildFirstPromptMap(path.join(this.claudeHome, 'history.jsonl'));
        const parsed = await this.processSessionFile(filePath, nameMap);
        if (!parsed) return null;
        const timestamps = await readFileTimestamps(filePath);
        return sessionsDb.createSession(parsed.sessionId, this.provider, parsed.projectPath, parsed.sessionName, timestamps.createdAt, timestamps.updatedAt, filePath);
    }
    async processSessionFile(filePath, nameMap) {
        const parsed = await extractFirstValidJsonlData(filePath, (rawData) => {
            const data = rawData;
            const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined;
            const projectPath = typeof data.cwd === 'string' ? data.cwd : undefined;
            if (!sessionId || !projectPath) return null;
            return { sessionId, projectPath };
        });
        if (!parsed) return null;
        const titles = await this.extractTitlesFromTranscript(filePath, parsed.sessionId);
        // PATCHED (local): skip headless script sessions (claude -p / SDK one-shots).
        // A real conversation has a desktop custom-title, an ai-title, an interactive
        // "mode" record, an entry in history.jsonl, or was created by this app.
        const existingRow = sessionsDb.getSessionByProviderSessionId(parsed.sessionId) ?? sessionsDb.getSessionById(parsed.sessionId);
        const createdByApp = Boolean(existingRow && existingRow.session_id !== existingRow.provider_session_id);
        const interactive = Boolean(titles.customTitle || titles.aiTitle || titles.hasMode || nameMap.interactiveIds?.has(parsed.sessionId) || createdByApp);
        if (!interactive) return null;
        const sessionName = titles.customTitle || titles.aiTitle || nameMap.get(parsed.sessionId) || titles.firstPrompt;
        return { ...parsed, sessionName: normalizeSessionName(sessionName, 'Untitled Claude Session') };
    }
    async extractTitlesFromTranscript(filePath, sessionId) {
        const result = { customTitle: undefined, aiTitle: undefined, firstPrompt: undefined, hasMode: false };
        try {
            const content = await readFile(filePath, 'utf8');
            const lines = content.split(/\r?\n/);
            for (let index = lines.length - 1; index >= 0; index -= 1) {
                if (result.customTitle && result.aiTitle && result.hasMode) break;
                const line = lines[index]?.trim();
                if (!line) continue;
                let data;
                try { data = JSON.parse(line); } catch { continue; }
                if (typeof data.sessionId === 'string' && data.sessionId !== sessionId) continue;
                if (data.type === 'mode' || data.type === 'permission-mode') result.hasMode = true;
                if (!result.customTitle && data.type === 'custom-title' && typeof data.customTitle === 'string' && data.customTitle.trim()) {
                    result.customTitle = data.customTitle.trim();
                }
                if (!result.aiTitle && data.type === 'ai-title' && typeof data.aiTitle === 'string' && data.aiTitle.trim()) {
                    result.aiTitle = data.aiTitle.trim();
                }
            }
            if (!result.customTitle && !result.aiTitle) {
                for (const raw of lines) {
                    const line = raw.trim();
                    if (!line) continue;
                    let data;
                    try { data = JSON.parse(line); } catch { continue; }
                    if (data.type !== 'user' || data.isSidechain) continue;
                    const text = textOfUserMessage(data.message);
                    if (isMeaningfulPrompt(text)) { result.firstPrompt = text.trim().slice(0, 200); break; }
                }
            }
        } catch { /* unreadable file: fall through */ }
        return result;
    }
}
