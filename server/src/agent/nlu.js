import {
  SHIFTS,
  addDays,
  lastWeekday,
  now,
  parseIsoDate,
  shiftById,
  toIsoDate,
  weekdayName,
} from '../utils/dates.js';
import {
  CHECKPOINTS,
  COST_CENTERS,
  ERROR_CODES,
  LINES,
  MODELS,
  PARTS,
  REWORK_CATEGORIES,
  SEVERITIES,
} from '../data/catalog.js';

/**
 * Understanding layer: turns a natural-language production question into an
 * explicit interpretation the planner can act on.
 *
 * Rule-based and deterministic on purpose. It is fast, free, auditable, and it
 * gives the discovery phase a concrete list of what the assistant currently
 * understands. An LLM pass can be layered on top (see llm.js) without changing
 * the interpretation shape.
 */

export const INTENTS = {
  ISSUE_SUMMARY: 'issue_summary',
  DAILY_SUMMARY: 'daily_summary',
  SHIFT_SUMMARY: 'shift_summary',
  TOP_ERROR_CODES: 'top_error_codes',
  AFFECTED_MODELS: 'affected_models',
  LINE_ISSUES: 'line_issues',
  PARTS_INVOLVED: 'parts_involved',
  VEHICLE_COUNT: 'vehicle_count',
  REWORK_COUNT: 'rework_count',
  CHECKPOINT_DETECTION: 'checkpoint_detection',
  COST_CENTER_IMPACT: 'cost_center_impact',
  MAINTENANCE_STATUS: 'maintenance_status',
  DOWNTIME: 'downtime',
  TREND: 'trend',
  DASHBOARD_LOOKUP: 'dashboard_lookup',
  CAPABILITIES: 'capabilities',
  GREETING: 'greeting',
  UNKNOWN: 'unknown',
};

const INTENT_RULES = [
  { intent: INTENTS.GREETING, patterns: [/^(hi|hello|hey|good (morning|afternoon|evening))\b/] },
  {
    intent: INTENTS.CAPABILITIES,
    patterns: [/what can you (do|answer)/, /help me/, /which questions/, /what do you know/],
  },
  {
    intent: INTENTS.DOWNTIME,
    patterns: [/downtime/, /stoppage/, /line stop/, /stopped/, /standstill/],
  },
  {
    intent: INTENTS.MAINTENANCE_STATUS,
    patterns: [/maintenance/, /integral portal/, /technician/, /ticket/, /repair/],
  },
  {
    intent: INTENTS.DASHBOARD_LOOKUP,
    patterns: [/power ?bi/, /dashboard/, /report link/, /which report/],
  },
  {
    intent: INTENTS.REWORK_COUNT,
    patterns: [
      /how many .*rework/,
      /vehicles? (were |was )?reworked/,
      /rework(ed)? (vehicles|count|cars)/,
      /removed from the line/,
      /taken off the line/,
    ],
  },
  {
    intent: INTENTS.VEHICLE_COUNT,
    patterns: [/how many vehicles/, /how many cars/, /vehicles affected/, /cars affected/],
  },
  {
    intent: INTENTS.TOP_ERROR_CODES,
    patterns: [/error codes?/, /problem codes?/, /fault codes?/, /which codes?/],
  },
  {
    intent: INTENTS.AFFECTED_MODELS,
    patterns: [/which (vehicle )?models?/, /what models?/, /models? (were )?affected/],
  },
  {
    intent: INTENTS.PARTS_INVOLVED,
    patterns: [/which parts?/, /what parts?/, /components? (were )?involved/, /parts? involved/],
  },
  {
    intent: INTENTS.CHECKPOINT_DETECTION,
    patterns: [/checkpoints?/, /which station/, /where (was|were) .*detected/, /detected the/],
  },
  {
    intent: INTENTS.COST_CENTER_IMPACT,
    patterns: [/cost cent(er|re)/, /cost impact/, /how much did .*cost/, /rework cost/],
  },
  {
    intent: INTENTS.LINE_ISSUES,
    patterns: [
      /which (production )?line/,
      /what line/,
      /worst line/,
      /line had (the )?(most|issues)/,
    ],
  },
  {
    intent: INTENTS.TREND,
    patterns: [/trend/, /compare/, /over the last/, /week over week/, /getting (better|worse)/],
  },
  {
    intent: INTENTS.SHIFT_SUMMARY,
    patterns: [
      /shift summary/,
      /(early|late|night) shift/,
      /which shifts?/,
      /shifts? (were )?affected/,
      /by shift/,
      /per shift/,
    ],
  },
  {
    intent: INTENTS.DAILY_SUMMARY,
    patterns: [/summar(y|ise|ize)/, /what happened/, /daily report/, /overview of/, /recap/],
  },
  {
    intent: INTENTS.ISSUE_SUMMARY,
    patterns: [
      /what problems?/,
      /which problems?/,
      /what issues?/,
      /which issues?/,
      /any (problems|issues)/,
      /problems? (did|do) we have/,
      /what went wrong/,
    ],
  },
];

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** Resolves the time expression in a question into an inclusive date range. */
const extractTimeframe = (text) => {
  const today = now();

  const isoMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch) {
    return { from: isoMatch[1], to: isoMatch[1], label: isoMatch[1], expression: isoMatch[1] };
  }

  const dayMonth = text.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/,
  );
  if (dayMonth) {
    const month = MONTHS.indexOf(dayMonth[2]) + 1;
    const day = String(dayMonth[1]).padStart(2, '0');
    const year = today.getUTCFullYear();
    const iso = `${year}-${String(month).padStart(2, '0')}-${day}`;
    return { from: iso, to: iso, label: iso, expression: dayMonth[0] };
  }

  if (/\btoday\b/.test(text)) {
    const iso = toIsoDate(today);
    return { from: iso, to: iso, label: `today (${iso})`, expression: 'today' };
  }

  if (/\byesterday\b/.test(text)) {
    const iso = toIsoDate(addDays(today, -1));
    return { from: iso, to: iso, label: `yesterday (${iso})`, expression: 'yesterday' };
  }

  if (/\blast week\b/.test(text)) {
    const from = toIsoDate(addDays(today, -13));
    const to = toIsoDate(addDays(today, -7));
    return { from, to, label: `last week (${from} to ${to})`, expression: 'last week' };
  }

  if (/\bthis week\b/.test(text)) {
    const from = toIsoDate(addDays(today, -today.getUTCDay() + 1));
    const to = toIsoDate(today);
    return { from, to, label: `this week (${from} to ${to})`, expression: 'this week' };
  }

  const lastN = text.match(/\blast (\d{1,2}) (day|days|week|weeks)\b/);
  if (lastN) {
    const amount = Number(lastN[1]);
    const days = lastN[2].startsWith('week') ? amount * 7 : amount;
    const from = toIsoDate(addDays(today, -(days - 1)));
    const to = toIsoDate(today);
    return { from, to, label: `the last ${days} days`, expression: lastN[0] };
  }

  if (/\blast month\b|\bthis month\b|\bpast month\b/.test(text)) {
    const from = toIsoDate(addDays(today, -27));
    const to = toIsoDate(today);
    return { from, to, label: `the last 28 days`, expression: 'month' };
  }

  const weekdayMatch = text.match(
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
  );
  if (weekdayMatch) {
    const date = lastWeekday(weekdayMatch[1], today);
    if (date) {
      const iso = toIsoDate(date);
      return {
        from: iso,
        to: iso,
        label: `${weekdayMatch[1].replace(/^./, (c) => c.toUpperCase())} ${iso}`,
        expression: weekdayMatch[1],
      };
    }
  }

  return null;
};

const extractShift = (text) => {
  // The periods the client demonstrated, written any of the usual ways:
  // "06:00-14:00", "between 06:00 and 14:00", "0600 until 1400".
  const span = String.raw`\s*(?:-|–|to|until|and)\s*`;
  if (new RegExp(String.raw`\b06:?00${span}14:?00\b`).test(text)) return 'S1';
  if (new RegExp(String.raw`\b14:?00${span}22:?00\b`).test(text)) return 'S2';
  if (new RegExp(String.raw`\b22:?00${span}06:?00\b`).test(text)) return 'S3';
  if (/\b(early|first|morning) shift\b/.test(text)) return 'S1';
  if (/\b(late|second|afternoon) shift\b/.test(text)) return 'S2';
  if (/\b(night|third) shift\b/.test(text)) return 'S3';
  const explicit = text.match(/\bshift ([123])\b|\bs([123])\b/);
  if (explicit) return `S${explicit[1] ?? explicit[2]}`;
  return null;
};

const findByName = (text, items, extra = () => []) => {
  for (const item of items) {
    const needles = [item.id, item.name, item.code, ...extra(item)].filter(Boolean);
    for (const needle of needles) {
      const token = String(needle).toLowerCase();
      if (token.length < 3) continue;
      if (text.includes(token)) return item;
    }
  }
  return null;
};

export const parseQuestion = (question) => {
  const text = String(question ?? '').toLowerCase().trim();
  const matched = [];

  for (const rule of INTENT_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      matched.push(rule.intent);
    }
  }

  const timeframe = extractTimeframe(text);
  const shiftId = extractShift(text);

  const line =
    findByName(text, LINES, (item) => [item.area]) ??
    (text.match(/\bline ([1-4])\b/) ? LINES[Number(text.match(/\bline ([1-4])\b/)[1]) - 1] : null);
  const model = findByName(text, MODELS, (item) => [
    item.name.split(' (')[0],
    item.name.replace(/[()]/g, ''),
  ]);
  const errorCodeEntry =
    findByName(text, ERROR_CODES, (item) => [item.description]) ??
    (text.match(/\be-?\s?(\d{4})\b/)
      ? ERROR_CODES.find((entry) => entry.code === `E-${text.match(/\be-?\s?(\d{4})\b/)[1]}`)
      : null);
  const part = findByName(text, PARTS);
  const costCenter = findByName(text, COST_CENTERS);
  const checkpoint = findByName(text, CHECKPOINTS);
  const reworkCategory = findByName(text, REWORK_CATEGORIES);
  const severity = SEVERITIES.find((value) => new RegExp(`\\b${value}\\b`).test(text)) ?? null;

  // Dimension filters sharpen almost any intent; a question that names only a
  // line still reads as "what happened on that line".
  let intent = matched[0] ?? INTENTS.UNKNOWN;
  if (intent === INTENTS.UNKNOWN) {
    if (errorCodeEntry || part || checkpoint || model) intent = INTENTS.ISSUE_SUMMARY;
    else if (line) intent = INTENTS.LINE_ISSUES;
    else if (timeframe || shiftId) intent = INTENTS.DAILY_SUMMARY;
  }

  const entities = {
    timeframe,
    shiftId,
    shift: shiftId ? shiftById(shiftId) : null,
    lineId: line?.id ?? null,
    line: line ?? null,
    modelId: model?.id ?? null,
    model: model ?? null,
    errorCode: errorCodeEntry?.code ?? null,
    errorCodeEntry: errorCodeEntry ?? null,
    partId: part?.id ?? null,
    part: part ?? null,
    costCenter: costCenter?.id ?? null,
    checkpointId: checkpoint?.id ?? null,
    checkpoint: checkpoint ?? null,
    reworkCategoryId: reworkCategory?.id ?? null,
    severity,
  };

  const signals = [
    timeframe && 'timeframe',
    shiftId && 'shift',
    line && 'line',
    model && 'model',
    errorCodeEntry && 'error code',
    part && 'part',
    checkpoint && 'checkpoint',
    costCenter && 'cost center',
    severity && 'severity',
  ].filter(Boolean);

  const confidence =
    intent === INTENTS.UNKNOWN
      ? 0.2
      : Math.min(0.98, 0.55 + matched.length * 0.12 + signals.length * 0.07);

  return {
    question,
    intent,
    alternateIntents: matched.slice(1),
    entities,
    signals,
    confidence: Number(confidence.toFixed(2)),
    // When no period is named, the assistant answers for the most recent
    // production day rather than silently scanning everything.
    resolvedTimeframe:
      timeframe ?? {
        from: toIsoDate(now()),
        to: toIsoDate(now()),
        label: `today (${toIsoDate(now())}, assumed)`,
        expression: null,
        assumed: true,
      },
  };
};

/** Filter object the repository understands, derived from an interpretation. */
export const toFilter = (interpretation, overrides = {}) => {
  const { entities, resolvedTimeframe } = interpretation;
  return {
    from: resolvedTimeframe.from,
    to: resolvedTimeframe.to,
    shiftId: entities.shiftId ?? undefined,
    lineId: entities.lineId ?? undefined,
    modelId: entities.modelId ?? undefined,
    errorCode: entities.errorCode ?? undefined,
    partId: entities.partId ?? undefined,
    costCenter: entities.costCenter ?? undefined,
    checkpointId: entities.checkpointId ?? undefined,
    severity: entities.severity ?? undefined,
    reworkCategoryId: entities.reworkCategoryId ?? undefined,
    ...overrides,
  };
};

export const describeShift = (shiftId) => {
  const shift = SHIFTS.find((entry) => entry.id === shiftId);
  return shift ? `${shift.name} (${shift.label})` : shiftId;
};

export const describeDate = (iso) => {
  try {
    return `${weekdayName(parseIsoDate(iso)).replace(/^./, (c) => c.toUpperCase())} ${iso}`;
  } catch {
    return iso;
  }
};
