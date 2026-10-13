import { performance } from 'node:perf_hooks';
import { INTENTS, parseQuestion, toFilter } from './nlu.js';
import { CONVERSATIONAL_INTENTS, plan } from './planner.js';
import { toolById } from './tools/index.js';
import { buildSpoken, compose } from './synthesizer.js';
import { narrate } from './llm.js';
import { t } from './i18n.js';
import { redactAnswer } from '../security/redaction.js';
import { recordAudit } from '../security/audit.js';
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
 *
 * Access is enforced twice: the route already required a signed-in user, and
 * here every tool's own permission is checked against the role before it runs.
 * A tool the role may not use is skipped, listed under `withheld`, reported in
 * the answer's `redactions` next to any redacted columns, and audited.
 */

const stage = (name, detail, extra = {}) => ({
  name,
  detail,
  at: new Date().toISOString(),
  ...extra,
});

/**
 * @param {object} args
 * @param {string} args.question
 * @param {object} args.access role + permissions
 * @param {object} [args.context] carried conversation context
 * @param {'en'|'de'} [args.language] forces the answer language; detected otherwise
 */
export const answerQuestion = async ({ question, access, context = {}, language }) => {
  const startedAt = performance.now();
  const trace = [];
  const facts = [];
  const withheld = [];

  const interpretation = parseQuestion(question, language ? { language } : {});
  const lang = interpretation.language;

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
      language: lang,
    }),
  );

  const steps = plan(interpretation, { permissions: access.permissions });

  if (CONVERSATIONAL_INTENTS.has(interpretation.intent) || steps.length === 0) {
    trace.push(stage('plan', 'No data retrieval required for this question'));
    const { spokenOverride: _unused, ...draft } = compose({ interpretation, facts, access, language: lang });
    return {
      id: newId('ans'),
      question,
      language: lang,
      interpretation: publicInterpretation(interpretation),
      answer: { ...draft, provider: 'deterministic' },
      sources: [],
      withheld,
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

    // Tool-level enforcement: the role must hold the tool's permission.
    if (tool.permission && !access.permissions.includes(tool.permission)) {
      withheld.push({ tool: tool.id, label: tool.label, source: tool.source, permission: tool.permission });
      trace.push(
        stage('withheld', `${tool.label} skipped: role ${access.role} lacks ${tool.permission}`, {
          tool: tool.id,
          source: tool.source,
          permission: tool.permission,
          withheld: true,
        }),
      );
      recordAudit({
        access,
        action: 'tool.withheld',
        resource: tool.id,
        outcome: 'denied',
        detail: `requires ${tool.permission}`,
      });
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
        access,
        language: lang,
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

  const draft = compose({ interpretation, facts, access, language: lang, withheld });
  const narration = await narrate({ interpretation, facts, draft, language: lang });

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
  narrated.spoken = draft.spokenOverride ?? buildSpoken(narrated, lang);
  delete narrated.spokenOverride;

  const answer = redactAnswer(narrated, access);

  // Withheld tools join the redaction list so the UI has one place to look.
  for (const entry of withheld) {
    answer.redactions.push({
      element: `tool:${entry.tool}`,
      reason: t(lang, 'withheld.tool', { tool: entry.label, permission: entry.permission }),
    });
  }

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
    language: lang,
    interpretation: publicInterpretation(interpretation),
    answer: { ...answer, provider: narration.provider, model: narration.model ?? null },
    sources,
    withheld,
    trace,
    elapsedMs: Math.round(performance.now() - startedAt),
    ...structuredPayloads(interpretation, facts),
  };
};

/**
 * Structured payloads next to the narrated answer, so the UI can render the
 * inbox, the calendar, the task list, the briefing, a dashboard or a measure
 * without parsing prose. Only present when the matching tool ran.
 */
const structuredPayloads = (interpretation, facts) => {
  const fact = (toolId) => facts.find((entry) => entry.tool === toolId)?.data ?? null;
  const payload = {};

  const mail = fact('mail.search');
  const needsReply = fact('mail.needsReply');
  const draft = fact('mail.draft');
  if (mail || needsReply || draft) {
    const items = mail?.items ?? (draft?.mail ? [draft.mail] : needsReply?.items ?? []);
    payload.mail = {
      items,
      total: mail?.total ?? items.length,
      unread: mail?.unread ?? null,
      needsReply: mail?.needsReply ?? needsReply?.total ?? null,
      filter: mail?.filter ?? null,
      query: mail?.query ?? draft?.query ?? null,
      mode: mail?.mode ?? needsReply?.mode ?? draft?.mode ?? 'mock',
    };
    if (needsReply?.items) payload.mail.needsReplyItems = needsReply.items;
  }
  if (draft?.draft) payload.draft = draft.draft;

  const events = fact('calendar.events');
  if (events) payload.events = { items: events.items, day: events.day, mode: events.mode };

  const tasks = fact('tasks.due') ?? fact('tasks.create');
  if (tasks) payload.tasks = { items: tasks.items ?? [], day: tasks.day ?? null, created: tasks.task ?? null };

  const briefing = fact('briefing.compose');
  if (briefing) payload.briefing = briefing;

  const dashboard = fact('dashboard.create')?.dashboard;
  if (dashboard) payload.dashboard = dashboard;

  const measure = fact('powerbi.measure');
  if (measure) {
    payload.measure = measure.measure
      ? {
          name: measure.measure.name,
          key: measure.measure.key,
          value: measure.measure.value,
          unit: measure.measure.unit,
          report: measure.measure.report,
          url: measure.measure.url,
        }
      : { name: null, value: null, unit: null, report: null, url: null, query: measure.query, available: measure.available };
  }

  return payload;
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
  language: interpretation.language,
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
    mailFilter: interpretation.entities.mailFilter ?? null,
    mailQuery: interpretation.entities.mailQuery ?? null,
    calendarDay: interpretation.entities.calendarDay ?? null,
    reminder: interpretation.entities.reminder ?? null,
    measureQuery: interpretation.entities.measureQuery ?? null,
  },
});
