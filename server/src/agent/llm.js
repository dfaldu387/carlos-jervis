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

let client = null;

const getClient = () => {
  if (!client) {
    client = new Anthropic({ apiKey: config.llm.apiKey });
  }
  return client;
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
