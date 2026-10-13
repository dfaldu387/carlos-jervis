import { performance } from 'node:perf_hooks';
import { INTENTS, parseQuestion, toFilter } from './nlu.js';
import { CONVERSATIONAL_INTENTS, plan } from './planner.js';
import { toolById } from './tools/index.js';
import { buildSpoken, compose } from './synthesizer.js';
import { narrate } from './llm.js';
import { redactAnswer } from '../security/redaction.js';
import { SOURCE_LABELS, buildConnectorRegistry } from '../connectors/index.js';
import { logger } from '../utils/logger.js';
import { newId } from '../utils/ids.js';

/**
 * The agent loop from the requirement document:
 *
 *   question -> understand -> choose sources -> retrieve -> combine -> answer
 *              -> supporting details / source context
 *
 * Every stage is recorded in `trace` so the client can see which systems were
 * consulted for any given answer. That traceability is a stated requirement and
 * also the practical answer to the security constraint: nothing is read that is
 * not visible in the trace.
 */

const stage = (name, detail, extra = {}) => ({
  name,
  detail,
  at: new Date().toISOString(),
  ...extra,
});

export const answerQuestion = async ({ question, access, context = {} }) => {
  const startedAt = performance.now();
  const trace = [];
  const facts = [];

  const interpretation = parseQuestion(question);

  // Carry forward the period or line from the previous turn when the new
  // question does not name one ("and the late shift?").
  if (!interpretation.entities.timeframe && context.lastTimeframe) {
    interpretation.resolvedTimeframe = { ...context.lastTimeframe, carriedOver: true };
  }
  if (!interpretation.entities.lineId && context.lastLineId && interpretation.intent !== INTENTS.LINE_ISSUES) {
    interpretation.entities.lineId = context.lastLineId;
    interpretation.entities.carriedLine = true;
  }

  trace.push(
    stage('understand', `Intent "${interpretation.intent}" at ${Math.round(interpretation.confidence * 100)}% confidence`, {
      signals: interpretation.signals,
      period: interpretation.resolvedTimeframe,
    }),
  );

  const steps = plan(interpretation, { permissions: access.permissions });

  if (CONVERSATIONAL_INTENTS.has(interpretation.intent) || steps.length === 0) {
    trace.push(stage('plan', 'No data retrieval required for this question'));
    const draft = compose({ interpretation, facts, access });
    return {
      id: newId('ans'),
      question,
      interpretation: publicInterpretation(interpretation),
      answer: { ...draft, provider: 'deterministic' },
      sources: [],
      trace,
      elapsedMs: Math.round(performance.now() - startedAt),
    };
  }

  trace.push(
    stage(
      'plan',
      `${steps.length} retrieval ${steps.length === 1 ? 'step' : 'steps'} across ${
        new Set(steps.map((step) => toolById(step.tool)?.source)).size
      } systems`,
      { steps: steps.map((step) => ({ tool: step.tool, reason: step.reason })) },
    ),
  );

  const filter = toFilter(interpretation);
  const registry = buildConnectorRegistry();

  for (const step of steps) {
    const tool = toolById(step.tool);
    if (!tool) {
      logger.warn('Planner referenced an unknown tool', { tool: step.tool });
      continue;
    }

    const connector = registry.find((entry) => entry.id === tool.source);
    const stepStart = performance.now();

    try {
      const result = await tool.run({
        filter,
        interpretation,
        permissions: access.permissions,
        role: access.role,
        ...step.args,
      });

      facts.push({ tool: tool.id, data: result.data, citation: result.citation });
      trace.push(
        stage('retrieve', `${tool.label} via ${SOURCE_LABELS[tool.source] ?? tool.source}`, {
          tool: tool.id,
          source: tool.source,
          mode: connector?.mode ?? 'mock',
          reason: step.reason,
          detail: result.citation?.detail,
          elapsedMs: Math.round(performance.now() - stepStart),
        }),
      );
    } catch (error) {
      logger.error('Retrieval step failed', { tool: tool.id, error: error.message });
      trace.push(
        stage('retrieve', `${tool.label} failed: ${error.message}`, {
          tool: tool.id,
          source: tool.source,
          failed: true,
        }),
      );
    }
  }

  trace.push(stage('combine', `Merged ${facts.length} result sets into one answer`));

  const draft = compose({ interpretation, facts, access });
  const narration = await narrate({ interpretation, facts, draft });

  trace.push(
    stage(
      'answer',
      narration.provider === 'claude'
        ? `Narrative generated with ${narration.model}`
        : 'Narrative composed from retrieval templates',
      narration.usage ? { usage: narration.usage } : {},
    ),
  );

  const narrated = { ...draft, narrative: narration.narrative };
  // The read-aloud form follows whichever narrative was actually used.
  narrated.spoken = buildSpoken(narrated);

  const answer = redactAnswer(narrated, access);

  if (answer.redactions.length > 0) {
    trace.push(
      stage('redact', `${answer.redactions.length} element(s) withheld for role ${access.role}`, {
        redactions: answer.redactions,
      }),
    );
  }

  const sources = dedupeCitations(facts, registry);

  return {
    id: newId('ans'),
    question,
    interpretation: publicInterpretation(interpretation),
    answer: { ...answer, provider: narration.provider, model: narration.model ?? null },
    sources,
    trace,
    elapsedMs: Math.round(performance.now() - startedAt),
  };
};

const dedupeCitations = (facts, registry) => {
  const bySource = new Map();
  for (const entry of facts) {
    const citation = entry.citation;
    if (!citation) continue;
    const key = `${citation.source}:${citation.object}`;
    const existing = bySource.get(key);
    if (existing) {
      existing.details.push(citation.detail);
      continue;
    }
    const connector = registry.find((item) => item.id === citation.source);
    bySource.set(key, {
      source: citation.source,
      label: SOURCE_LABELS[citation.source] ?? citation.source,
      object: citation.object,
      details: [citation.detail],
      url: citation.url ?? connector?.openUrl ?? null,
      mode: connector?.mode ?? 'mock',
    });
  }
  return [...bySource.values()];
};

/** The slice of the interpretation the UI is allowed to show. */
const publicInterpretation = (interpretation) => ({
  intent: interpretation.intent,
  confidence: interpretation.confidence,
  signals: interpretation.signals,
  period: interpretation.resolvedTimeframe,
  filters: {
    shift: interpretation.entities.shift?.id ?? null,
    shiftLabel: interpretation.entities.shift
      ? `${interpretation.entities.shift.name} ${interpretation.entities.shift.label}`
      : null,
    line: interpretation.entities.line?.name ?? null,
    lineId: interpretation.entities.lineId ?? null,
    model: interpretation.entities.model?.name ?? null,
    errorCode: interpretation.entities.errorCode,
    part: interpretation.entities.part?.name ?? null,
    checkpoint: interpretation.entities.checkpoint?.name ?? null,
    costCenter: interpretation.entities.costCenter,
    severity: interpretation.entities.severity,
  },
});
