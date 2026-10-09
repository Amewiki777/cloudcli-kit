// PATCHED (local): model labels carry version numbers (aliases unchanged).
import { readFile } from 'node:fs/promises';
import { sessionsDb } from '../../../../modules/database/index.js';
import { buildDefaultProviderCurrentActiveModel } from '../../../../shared/utils.js';
/**
 * Ultracode is not one of the SDK's reasoning-effort levels. Selecting it runs the turn at
 * `xhigh` effort with standing dynamic-workflow orchestration, which the Claude runtime
 * translates into the session-scoped `ultracode` setting. It is therefore only offered on
 * models this catalog already marks as xhigh-capable.
 */
export const CLAUDE_ULTRACODE_EFFORT = 'ultracode';
const ULTRACODE_EFFORT_OPTION = {
    value: CLAUDE_ULTRACODE_EFFORT,
    description: 'Highest effort plus standing workflow orchestration.',
};
export const CLAUDE_PREDEFINED_MODELS = {
    OPTIONS: [
        {
            value: 'default',
            label: 'Default (recommended)',
            description: 'Use the recommended model for your Claude account and deployment.',
            effort: {
                default: 'high',
                values: [
                    { value: 'low' },
                    { value: 'medium' },
                    { value: 'high' },
                    { value: 'max' },
                ],
            },
        },
        {
            value: 'best',
            label: 'Best available',
            description: 'Use Fable 5.1 when available, otherwise Opus 5.5.',
            effort: {
                default: 'high',
                values: [
                    { value: 'low' },
                    { value: 'medium' },
                    { value: 'high' },
                    { value: 'xhigh' },
                    { value: 'max' },
                    ULTRACODE_EFFORT_OPTION,
                ],
            },
        },
        {
            value: 'fable',
            label: 'Fable 5.1',
            description: 'Most capable Claude model for the hardest, longest-running tasks.',
            effort: {
                default: 'high',
                values: [
                    { value: 'low' },
                    { value: 'medium' },
                    { value: 'high' },
                    { value: 'xhigh' },
                    { value: 'max' },
                    ULTRACODE_EFFORT_OPTION,
                ],
            },
        },
        {
            value: 'sonnet',
            label: 'Sonnet 5',
            description: 'Latest Sonnet model for everyday coding tasks.',
            effort: {
                default: 'high',
                values: [
                    { value: 'low' },
                    { value: 'medium' },
                    { value: 'high' },
                    { value: 'xhigh' },
                    { value: 'max' },
                    ULTRACODE_EFFORT_OPTION,
                ],
            },
        },
        {
            value: 'sonnet[1m]',
            label: 'Sonnet 5 (1M context)',
            description: 'Latest Sonnet model with a 1M context window.',
            effort: {
                default: 'high',
                values: [
                    { value: 'low' },
                    { value: 'medium' },
                    { value: 'high' },
                    { value: 'xhigh' },
                    { value: 'max' },
                    ULTRACODE_EFFORT_OPTION,
                ],
            },
        },
        {
            value: 'opus',
            label: 'Opus 5.5',
            description: 'Latest Opus model for complex reasoning and coding tasks.',
            effort: {
                default: 'high',
                values: [
                    { value: 'low' },
                    { value: 'medium' },
                    { value: 'high' },
                    { value: 'xhigh' },
                    { value: 'max' },
                    ULTRACODE_EFFORT_OPTION,
                ],
            },
        },
        {
            value: 'opus[1m]',
            label: 'Opus 5.5 (1M context)',
            description: 'Latest Opus model with a 1M context window.',
            effort: {
                default: 'high',
                values: [
                    { value: 'low' },
                    { value: 'medium' },
                    { value: 'high' },
                    { value: 'xhigh' },
                    { value: 'max' },
                    ULTRACODE_EFFORT_OPTION,
                ],
            },
        },
        {
            value: 'haiku',
            label: 'Haiku 4.5',
            description: 'Fast and efficient Claude model for simple tasks.',
        },
        {
            value: 'opusplan',
            label: 'Opus 5.5 Plan',
            description: 'Use Opus while planning, then switch to Sonnet for execution.',
            effort: {
                default: 'high',
                values: [
                    { value: 'low' },
                    { value: 'medium' },
                    { value: 'high' },
                    { value: 'xhigh' },
                    { value: 'max' },
                    ULTRACODE_EFFORT_OPTION,
                ],
            },
        },
    ],
    DEFAULT: 'default',
};
export const findClaudeModelOption = (model) => {
    const normalizedModel = typeof model === 'string' ? model.trim() : '';
    if (!normalizedModel) {
        return null;
    }
    return CLAUDE_PREDEFINED_MODELS.OPTIONS.find((option) => option.value === normalizedModel) ?? null;
};
const ANSI_PATTERN = new RegExp('[\\u001B\\u009B][[\\]()#;?]*(?:'
    + '(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]'
    + '|(?:[\\dA-PR-TZcf-ntqry=><~]))', 'g');
/**
 * Claude Code stamps locally-synthesized rows (API-error placeholders and the
 * like) with `model: "<synthetic>"`. Angle-bracketed values are placeholders,
 * never real model ids, and must not be surfaced as the session's model.
 */
const isPlaceholderModel = (model) => model.startsWith('<') && model.endsWith('>');
/** Exported for tests. */
export const extractClaudeEventModel = (event, sessionId) => {
    const eventSessionId = event.sessionId ?? event.session_id;
    if (eventSessionId && eventSessionId !== sessionId) {
        return null;
    }
    const contentModel = extractClaudeModelFromMessageContent(event.message?.content);
    if (contentModel) {
        return contentModel;
    }
    const directModel = event.model?.trim();
    if (directModel && !isPlaceholderModel(directModel)) {
        return directModel;
    }
    const messageModel = event.message?.model?.trim();
    return messageModel && !isPlaceholderModel(messageModel) ? messageModel : null;
};
const stripAnsi = (value) => value.replace(ANSI_PATTERN, '');
const extractTaggedContent = (content, tagName) => {
    const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`<${escapedTagName}>([\\s\\S]*?)<\\/${escapedTagName}>`).exec(content);
    return match ? match[1] : null;
};
const extractClaudeModelFromTextContent = (content) => {
    const localCommandStdout = extractTaggedContent(content, 'local-command-stdout');
    if (localCommandStdout !== null) {
        const cleanedStdout = stripAnsi(localCommandStdout).replace(/\s+/g, ' ').trim();
        const changedModel = /(?:set|changed|switched)\s+model\s+to\s+(.+?)\.?$/i.exec(cleanedStdout);
        const stdoutModel = changedModel?.[1]?.trim();
        // A placeholder stdout hit must not shadow a real <model> tag further down.
        if (stdoutModel && !isPlaceholderModel(stdoutModel)) {
            return stdoutModel;
        }
    }
    const modelTag = extractTaggedContent(content, 'model')?.trim();
    return modelTag && !isPlaceholderModel(modelTag) ? modelTag : null;
};
const extractClaudeModelFromMessageContent = (content) => {
    if (typeof content === 'string') {
        return extractClaudeModelFromTextContent(content);
    }
    if (!Array.isArray(content)) {
        return null;
    }
    for (const part of content) {
        if (!part || typeof part !== 'object' || !('text' in part) || typeof part.text !== 'string') {
            continue;
        }
        // extractClaudeModelFromTextContent rejects placeholders, so a placeholder
        // part yields null here and a later part can still supply the real model.
        const model = extractClaudeModelFromTextContent(part.text);
        if (model) {
            return model;
        }
    }
    return null;
};
const readClaudeSessionModelFromJsonl = async (sessionId, jsonlPath) => {
    const content = await readFile(jsonlPath, 'utf8');
    const lines = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        try {
            const event = JSON.parse(lines[index]);
            const model = extractClaudeEventModel(event, sessionId);
            if (model) {
                return { model };
            }
        }
        catch {
            // Skip malformed JSONL lines that can happen during concurrent writes.
        }
    }
    return null;
};
export class ClaudeProviderModels {
    async getSupportedModels() {
        // claude creates a new jsonl file as a separate session for this request.
        // As a result, it lists the workspace where this is invoked when it shouldn't.
        //
        // Disabled for now:
        // const queryInstance = query({
        //   prompt: 'Get supported models',
        //   options: buildClaudeQueryOptions(),
        // });
        // const supportedModels = await queryInstance.supportedModels();
        // queryInstance.close();
        // return buildClaudeModelsDefinition(supportedModels);
        return CLAUDE_PREDEFINED_MODELS;
    }
    async getCurrentActiveModel(sessionId) {
        if (!sessionId?.trim()) {
            return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
        }
        try {
            const jsonlPath = sessionsDb.getSessionById(sessionId)?.jsonl_path;
            const activeModel = jsonlPath
                ? await readClaudeSessionModelFromJsonl(sessionId, jsonlPath)
                : null;
            if (activeModel?.model) {
                return activeModel;
            }
        }
        catch {
            // Fall through to the provider default when the session-backed lookup fails.
        }
        return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
    }
}
//# sourceMappingURL=claude-models.provider.js.map