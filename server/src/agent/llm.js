import Anthropic from '@anthropic-ai/sdk';
import { config, llmEnabled } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Optional narration layer.
 *
 * The deterministic synthesizer always produces the answer. When
 * JERVIS_LLM_PROVIDER=claude, the retrieved facts and that draft are handed to
 * Claude to reword the narrative for a management reader. The model is given
 * the facts only and is told not to introduce figures, so every number in the
 * final answer still traces back to a retrieval step. If the call fails for any
 * reason the deterministic text is returned unchanged.
 */

const SYSTEM_PROMPT = `You are Jervis, an assistant for manufacturing and production management at an automotive assembly plant.

You are given:
- the user's question
- the interpretation the retrieval layer produced
- the facts retrieved from the production systems (Databricks, Power BI, Integral Portal, MQTT)
- a deterministic draft of the narrative

Rewrite the narrative so a production manager can act on it.

Rules:
- Use only numbers, codes, names and dates present in the facts or the draft. Never introduce, estimate, round or infer a figure.
- Do not add recommendations that the data does not support.
- Keep it to two or three short paragraphs, plain sentences, no markdown headings, no bullet characters.
- Name the system a figure came from when it is not obvious.
- If the facts are empty, say plainly that nothing was recorded for the period.
- Answer in the language named in the request (English or German). German answers use the formal "Sie".`;

const DRAFT_PROMPT = `You are Jervis, the assistant of a production manager at an automotive assembly plant. You draft email replies on the manager's behalf.

You are given the incoming mail, a deterministic draft and optional instructions from the manager.

Rewrite the draft so it reads naturally and acts on the instructions.

Rules:
- Use only facts present in the incoming mail, the draft or the instructions. Never invent dates, quantities, names or commitments.
- Keep the greeting, the sign-off and the tone (formal or friendly) of the draft.
- Plain text only, short paragraphs, no subject line, no markdown.
- Write in the language named in the request (English or German). German replies use the formal "Sie".
- Return the body only.`;

const TRANSLATE_PROMPT = `You translate short UI strings for a production-management dashboard between English and German.

Rules:
- Translate naturally and concisely, the way a German production manager would phrase it; German uses the formal register.
- Keep product and system names, production line names (e.g. "Paint Line 2", "FA2"), error codes, numbers and dates exactly as given.
- Preserve the meaning; never add, drop or invent information.
- Return ONLY a JSON object with exactly the same keys as the input, each value being the translation in {language}. No commentary, no code fences.`;

let client = null;

const getClient = () => {
  if (!client) {
    client = new Anthropic({ apiKey: config.llm.apiKey });
  }
  return client;
};

/** First balanced JSON object in a string, or null. Tolerates stray prose or fences. */
const extractJsonObject = (text) => {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
};

/**
 * Translates a dashboard's free-text strings (its name, the question it was
 * built from, the period label) into the target language. Returns an object
 * with the same keys translated, or null when Claude is not enabled or the call
 * does not yield usable text, so callers fall back to the stored strings.
 *
 * @param {{ texts: Record<string,string>, language: 'en'|'de' }} args
 * @returns {Promise<Record<string,string> | null>}
 */
export const translateDashboardText = async ({ texts, language = 'en' }) => {
  if (!llmEnabled()) return null;
  const entries = Object.entries(texts ?? {}).filter(([, value]) => typeof value === 'string' && value.trim());
  if (entries.length === 0) return null;
  const source = Object.fromEntries(entries);
  const target = language === 'de' ? 'German' : 'English';

  try {
    const response = await getClient().messages.create({
      model: config.llm.model,
      max_tokens: 500,
      system: TRANSLATE_PROMPT.replace('{language}', target),
      messages: [
        {
          role: 'user',
          content: `Translate the values of this JSON into ${target}. Return only the JSON object.\n${JSON.stringify(source)}`,
        },
      ],
    });
    if (response.stop_reason === 'refusal') {
      logger.warn('LLM dashboard translation declined; keeping original text');
      return null;
    }
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();
    const json = extractJsonObject(text);
    if (!json) return null;
    const out = {};
    for (const key of Object.keys(source)) {
      if (typeof json[key] === 'string' && json[key].trim()) out[key] = json[key].trim();
    }
    return Object.keys(out).length ? out : null;
  } catch (error) {
    logger.warn('LLM dashboard translation failed; keeping original text', { error: error.message });
    return null;
  }
};

/**
 * @returns {Promise<{narrative: string[], provider: string, model?: string, usage?: object}>}
 */
export const narrate = async ({ interpretation, facts, draft, language = 'en' }) => {
  if (!llmEnabled()) {
    return { narrative: draft.narrative, provider: 'deterministic' };
  }

  const payload = {
    question: interpretation.question,
    language: language === 'de' ? 'German' : 'English',
    interpretation: {
      intent: interpretation.intent,
      period: interpretation.resolvedTimeframe,
      entities: Object.fromEntries(
        Object.entries(interpretation.entities).filter(([, value]) => value && typeof value !== 'object'),
      ),
    },
    facts: facts.map((entry) => ({ tool: entry.tool, source: entry.citation?.source, data: entry.data })),
    draft: {
      headline: draft.headline,
      narrative: draft.narrative,
      metrics: draft.metrics?.map(({ label, value, format }) => ({ label, value, format })),
    },
  };

  try {
    const response = await getClient().messages.create({
      model: config.llm.model,
      max_tokens: 1600,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `${JSON.stringify(payload, null, 2)}\n\nRewrite the narrative in ${payload.language}.`,
        },
      ],
    });

    if (response.stop_reason === 'refusal') {
      logger.warn('LLM narration declined; keeping deterministic text', {
        category: response.stop_details?.category ?? null,
      });
      return { narrative: draft.narrative, provider: 'deterministic', fallback: 'refusal' };
    }

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    if (!text) {
      return { narrative: draft.narrative, provider: 'deterministic', fallback: 'empty' };
    }

    return {
      narrative: text
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
        .filter(Boolean),
      provider: 'claude',
      model: config.llm.model,
      usage: {
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
      },
    };
  } catch (error) {
    logger.warn('LLM narration failed; keeping deterministic text', { error: error.message });
    return { narrative: draft.narrative, provider: 'deterministic', fallback: 'error' };
  }
};

/**
 * Optional rewording of a reply draft. Returns null whenever Claude is not
 * enabled or the call does not produce usable text, so the caller keeps the
 * deterministic draft.
 *
 * @returns {Promise<{ body: string, model: string } | null>}
 */
export const draftReplyWithClaude = async ({ mail, draft, instructions = '', language = 'en' }) => {
  if (!llmEnabled()) return null;

  const payload = {
    language: language === 'de' ? 'German' : 'English',
    mail: {
      from: mail.from,
      subject: mail.subject,
      receivedAt: mail.receivedAt,
      category: mail.category,
      body: mail.body,
    },
    draft: { tone: draft.tone, body: draft.body },
    instructions: String(instructions ?? '').trim() || null,
  };

  try {
    const response = await getClient().messages.create({
      model: config.llm.model,
      max_tokens: 1200,
      system: DRAFT_PROMPT,
      messages: [
        {
          role: 'user',
          content: `${JSON.stringify(payload, null, 2)}\n\nRewrite the draft body in ${payload.language}.`,
        },
      ],
    });
    if (response.stop_reason === 'refusal') {
      logger.warn('LLM draft declined; keeping deterministic draft');
      return null;
    }
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();
    return text ? { body: text, model: config.llm.model } : null;
  } catch (error) {
    logger.warn('LLM draft failed; keeping deterministic draft', { error: error.message });
    return null;
  }
};
