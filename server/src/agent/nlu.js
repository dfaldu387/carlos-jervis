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
import { dateLabel, normalizeLanguage, t } from './i18n.js';
import { isReminderRequest, parseReminder } from '../secretary/reminders.js';

/**
 * Understanding layer: turns a natural-language question into an explicit
 * interpretation the planner can act on.
 *
 * Rule-based and deterministic on purpose. It is fast, free, auditable, and it
 * gives the discovery phase a concrete list of what the assistant currently
 * understands. An LLM pass can be layered on top (see llm.js) without changing
 * the interpretation shape.
 *
 * English and German are handled side by side: every rule carries both sets
 * of trigger words, the language is detected from the question (or forced by
 * the caller), and period labels come out in that language.
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
  // Secretary intents.
  INBOX_SUMMARY: 'inbox_summary',
  MAIL_SEARCH: 'mail_search',
  CALENDAR_TODAY: 'calendar_today',
  DAILY_BRIEFING: 'daily_briefing',
  CREATE_REMINDER: 'create_reminder',
  DRAFT_REPLY: 'draft_reply',
  POWERBI_MEASURE: 'powerbi_measure',
  CREATE_DASHBOARD: 'create_dashboard',
  TRIGGER_FLOW: 'trigger_flow',
  CAPABILITIES: 'capabilities',
  GREETING: 'greeting',
  UNKNOWN: 'unknown',
};

/**
 * Order matters: the first rule that matches names the intent, the rest are
 * kept as alternates. The secretary rules sit in front because their trigger
 * words often contain production vocabulary ("remind me to check the error
 * codes", "a dashboard for paint line issues").
 */
const INTENT_RULES = [
  {
    intent: INTENTS.CREATE_REMINDER,
    patterns: [/\bremind me\b/, /\b(set|create|add) (a |an )?(reminder|task|to-?do)\b/, /\berinner(e|ung)\b/, /\baufgabe anlegen\b/],
  },
  {
    intent: INTENTS.DRAFT_REPLY,
    patterns: [
      /\bdraft (a |an |the )?(reply|answer|response)\b/,
      /\b(reply|respond|answer) to (the |that |this )?[\w-]*\s?(e-?mail|mail|message)\b/,
      /\bwrite (a |an |the )?(reply|answer|response)\b/,
      /\bantworte? (auf|an)\b/,
      /\b(entwirf|entwerfe|schreib|schreibe|verfasse?) (bitte )?(eine |die )?antwort\b/,
      /\bantwort(entwurf| entwerfen| schreiben| verfassen)\b/,
    ],
  },
  {
    intent: INTENTS.CREATE_DASHBOARD,
    patterns: [
      /\b(create|build|make|generate|set up|give me) (a |an |me a )?(new |simple |quick )?dashboard\b/,
      /\bdashboard (for|of|about|showing|with)\b/,
      /\b(erstelle?|bau|baue|mach|mache|generiere?|lege?) (mir )?(bitte )?(ein |ein neues |ein einfaches )?dashboard\b/,
      /\bdashboard (für|zu|mit|über)\b/,
    ],
  },
  {
    intent: INTENTS.POWERBI_MEASURE,
    patterns: [
      /\b(what|how (high|much|big)|where) (is|was|are) (the |our )?[\w\s-]{2,60}? (in|from|on|according to) power ?bi\b/,
      /\bmeasure\b/,
      /\bkpi\b/,
      /\bkennzahl/,
      /\bmesswert\b/,
      /\b(wie hoch|was|wo) (ist|war|sind|steht) (die |der |das |unsere? )?[\w\s-]{2,60}? (in|aus|laut) power ?bi\b/,
      /\bpower ?bi[\s-]*(wert|zahl|kennzahl)\b/,
      /\b(oee|first pass yield|fpy|rework rate|nacharbeitsquote)\b.*\bpower ?bi\b/,
      /\bpower ?bi\b.*\b(oee|first pass yield|fpy|rework rate|nacharbeitsquote)\b/,
    ],
  },
  {
    // Start an approved Power Automate flow. A trigger verb paired with a
    // flow-ish noun; "escalate"/"eskalieren" is strong enough on its own. The
    // tool only ever proposes - nothing runs without an explicit confirmation.
    intent: INTENTS.TRIGGER_FLOW,
    patterns: [
      /\b(escalat|eskalier)/,
      // The noun is matched as a substring so German compounds work
      // ("Wartungsanfrage", "Tagesbericht").
      /\b(trigger|start|run|launch|send|distribute|initiate|starte|starten|sende|senden|verteile|verteilen|ausl(ö|oe)s|ausf(ü|ue)hr|anstoß|anstoss)\w*\b[\s\S]*(flow|workflow|automation|automatisierung|ablauf|escalation|eskalation|quality|qualit(ä|ae)t|maintenance|wartung|instandhaltung|report|bericht|request|anfrage|visit|besuch|issue|problem|ticket)/,
      /\b(flow|workflow|automation|automatisierung|ablauf)\b[\s\S]*\b(trigger|start|starten|run|launch|ausl(ö|oe)s|ausf(ü|ue)hr)/,
    ],
  },
  {
    intent: INTENTS.DAILY_BRIEFING,
    patterns: [
      /\bbriefing\b/,
      /\bwhat do i need to know\b/,
      /\bstart (my|the) day\b/,
      /\bwhat('s| is) (important|new) today\b/,
      /\btagesbriefing\b/,
      /\bmorgenbriefing\b/,
      /\bwas steht heute an\b/,
      /\bwas muss ich heute wissen\b/,
      /\bwas ist heute wichtig\b/,
    ],
  },
  {
    intent: INTENTS.MAIL_SEARCH,
    patterns: [
      /\b(find|search|look for|locate|show me) (the |an? |my )?(e-?mails?|mails?|messages?) (from|about|regarding|on|with)\b/,
      /\bsearch (my )?(inbox|e-?mails?|mails?) for\b/,
      /\b(e-?mail|mail|message) from [a-zäöüß]/,
      /\b(e-?mails?|mails?|nachrichte?n?) (von|über|zu|wegen) .*(suchen|finden|zeigen|anzeigen)\b/,
      /\b(suche?|finde?|zeige?) (mir )?(bitte )?(die |eine |alle )?(e-?mails?|mails?|nachrichte?n?) (von|über|zu|wegen|mit)\b/,
    ],
  },
  {
    intent: INTENTS.INBOX_SUMMARY,
    patterns: [
      /\binbox\b/,
      /\bunread\b/,
      /\b(e-?mails?|mails?|messages?)\b.*\b(reply|answer|respond|unanswered|waiting)\b/,
      /\b(reply|answer)\b.*\b(e-?mails?|mails?|messages?)\b/,
      /\b(my |new |any |the )(e-?mails?|mails?)\b/,
      /\bposteingang\b/,
      /\bungelesen/,
      /\b(e-?mails?|mails?|nachrichten)\b.*\b(beantwort|antwort|unbeantwortet)/,
      /\b(meine|neue|gibt es) (e-?mails?|mails?|nachrichten)\b/,
    ],
  },
  {
    intent: INTENTS.CALENDAR_TODAY,
    patterns: [
      /\bcalendar\b/,
      /\bappointments?\b/,
      /\bmeetings? (today|tomorrow|this (morning|afternoon))\b/,
      /\b(my )?schedule (today|tomorrow|for)\b/,
      /\bwhat('s| is) on (today|tomorrow)\b/,
      /\bkalender\b/,
      /\btermine?\b/,
      /\bbesprechungen (heute|morgen)\b/,
    ],
  },
  {
    intent: INTENTS.GREETING,
    patterns: [
      /^(hi|hello|hey|good (morning|afternoon|evening))\b/,
      /^(hallo|servus|moin|guten (morgen|tag|abend))\b/,
    ],
  },
  {
    intent: INTENTS.CAPABILITIES,
    patterns: [
      /what can you (do|answer)/,
      /help me/,
      /which questions/,
      /what do you know/,
      /was kannst du/,
      /hilf mir/,
      /welche fragen/,
      /was weißt du/,
    ],
  },
  {
    intent: INTENTS.DOWNTIME,
    patterns: [
      /downtime/,
      /stoppage/,
      /line stop/,
      /stopped/,
      /standstill/,
      /stillst(a|ä)nd/,
      /ausf(a|ä)ll/,
      /linienstopp/,
      /stand(en)? (die|eine) linien?/,
    ],
  },
  {
    intent: INTENTS.MAINTENANCE_STATUS,
    patterns: [
      /maintenance/,
      /integral portal/,
      /technician/,
      /ticket/,
      /repair/,
      /wartung/,
      /instandhaltung/,
      /techniker/,
      /reparatur/,
    ],
  },
  {
    intent: INTENTS.DASHBOARD_LOOKUP,
    patterns: [/power ?bi/, /dashboard/, /report link/, /which report/, /welcher (power ?bi[- ])?bericht/, /berichtslink/],
  },
  {
    intent: INTENTS.REWORK_COUNT,
    patterns: [
      /how many .*rework/,
      /vehicles? (were |was )?reworked/,
      /rework(ed)? (vehicles|count|cars)/,
      /removed from the line/,
      /taken off the line/,
      /nacharbeit/,
      /nachgearbeitet/,
      /aus der linie genommen/,
    ],
  },
  {
    intent: INTENTS.VEHICLE_COUNT,
    patterns: [
      /how many vehicles/,
      /how many cars/,
      /vehicles affected/,
      /cars affected/,
      /wie viele fahrzeuge/,
      /wie viele autos/,
      /fahrzeuge (sind |waren )?betroffen/,
    ],
  },
  {
    intent: INTENTS.TOP_ERROR_CODES,
    patterns: [/error codes?/, /problem codes?/, /fault codes?/, /which codes?/, /fehlercodes?/, /fehlernummer/, /welche codes?/],
  },
  {
    intent: INTENTS.AFFECTED_MODELS,
    patterns: [
      /which (vehicle )?models?/,
      /what models?/,
      /models? (were )?affected/,
      /welche (fahrzeug)?modelle?/,
      /modelle? (waren |sind )?betroffen/,
    ],
  },
  {
    intent: INTENTS.PARTS_INVOLVED,
    patterns: [
      /which parts?/,
      /what parts?/,
      /components? (were )?involved/,
      /parts? involved/,
      /welche (bau)?teile/,
      /teile (waren |sind )?beteiligt/,
      /komponenten/,
    ],
  },
  {
    intent: INTENTS.CHECKPOINT_DETECTION,
    patterns: [
      /checkpoints?/,
      /which station/,
      /where (was|were) .*detected/,
      /detected the/,
      /pr(ü|ue)fpunkt/,
      /welche station/,
      /wo (wurde|wurden) .*erkannt/,
    ],
  },
  {
    intent: INTENTS.COST_CENTER_IMPACT,
    patterns: [/cost cent(er|re)/, /cost impact/, /how much did .*cost/, /rework cost/, /kostenstelle/, /kostenauswirkung/, /nacharbeitskosten/, /was hat .*gekostet/],
  },
  {
    intent: INTENTS.LINE_ISSUES,
    patterns: [
      /which (production )?line/,
      /what line/,
      /worst line/,
      /line had (the )?(most|issues)/,
      /welche (produktions)?linie/,
      /schlechteste linie/,
      /linie (hatte|mit) (die |den )?meisten/,
    ],
  },
  {
    intent: INTENTS.TREND,
    patterns: [/trend/, /compare/, /over the last/, /week over week/, /getting (better|worse)/, /vergleich/, /verlauf/, /(ü|ue)ber die letzten/, /besser oder schlechter/],
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
      /schichtzusammenfassung/,
      /(fr(ü|ue)h|sp(ä|ae)t|nacht)schicht/,
      /welche schichten?/,
      /(pro|nach|je) schicht/,
    ],
  },
  {
    intent: INTENTS.DAILY_SUMMARY,
    patterns: [
      /summar(y|ise|ize)/,
      /what happened/,
      /daily report/,
      /overview of/,
      /recap/,
      /zusammenfass/,
      /fasse? .*zusammen/,
      /was ist passiert/,
      /tagesbericht/,
      /(ü|ue)berblick/,
    ],
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
      /welche probleme/,
      /was f(ü|ue)r probleme/,
      /probleme (hatten|haben|gab)/,
      /gab es probleme/,
      /was ist schiefgelaufen/,
      /welche fehler\b/,
      /welche st(ö|oe)rungen/,
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

const MONTHS_DE = [
  'januar',
  'februar',
  'märz',
  'april',
  'mai',
  'juni',
  'juli',
  'august',
  'september',
  'oktober',
  'november',
  'dezember',
];

const WEEKDAYS_DE = {
  montag: 'monday',
  dienstag: 'tuesday',
  mittwoch: 'wednesday',
  donnerstag: 'thursday',
  freitag: 'friday',
  samstag: 'saturday',
  sonntag: 'sunday',
};

// ---- language detection -----------------------------------------------------

const GERMAN_WORDS = new Set([
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'und', 'oder',
  'nicht', 'kein', 'keine', 'ich', 'mir', 'mich', 'mein', 'meine', 'meinen', 'meinem', 'wir', 'uns',
  'ist', 'sind', 'war', 'waren', 'gab', 'hatten', 'haben', 'hat', 'wurde', 'wurden', 'welche', 'welcher',
  'welches', 'wie', 'viele', 'wo', 'wann', 'warum', 'heute', 'gestern', 'vorgestern', 'morgen', 'woche',
  'monat', 'letzte', 'letzten', 'diese', 'diesen', 'dieser', 'auf', 'für', 'fuer', 'über', 'ueber', 'von',
  'nach', 'mit', 'bei', 'zum', 'zur', 'probleme', 'problem', 'fehler', 'fehlercode', 'fehlercodes',
  'schicht', 'frühschicht', 'spätschicht', 'nachtschicht', 'linie', 'modell', 'modelle', 'teil', 'teile',
  'kostenstelle', 'prüfpunkt', 'fahrzeuge', 'fahrzeug', 'nacharbeit', 'stillstand', 'ausfall', 'wartung',
  'zeig', 'zeige', 'erstelle', 'erinnere', 'antworte', 'posteingang', 'ungelesene', 'ungelesen', 'termine',
  'termin', 'kalender', 'kennzahl', 'briefing', 'tagesbriefing', 'steht', 'an', 'bitte', 'gib', 'fasse',
  'zusammen', 'es', 'im', 'am', 'beantworten', 'antwort', 'mails', 'nachrichten', 'aufgabe', 'aufgaben',
  'hallo', 'guten', 'tag', 'abend', 'kann', 'kannst', 'du', 'sie', 'was', 'muss', 'wissen', 'soll',
  'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag', 'um', 'uhr', 'daran',
  'anrufen', 'anzurufen', 'lieferant', 'lieferanten', 'brauchen', 'braucht',
  'eskaliere', 'eskalieren', 'starte', 'starten', 'auslösen', 'ausführen', 'sende', 'senden', 'verteile',
  'verteilen', 'ablauf', 'anstoßen', 'tagesbericht', 'wartungsanfrage', 'wartungsbesuch', 'qualitätsproblem',
]);

const ENGLISH_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'not', 'no', 'i', 'me', 'my', 'we', 'our', 'is', 'are', 'was', 'were',
  'did', 'do', 'have', 'has', 'had', 'which', 'what', 'how', 'many', 'where', 'when', 'why', 'today',
  'yesterday', 'tomorrow', 'week', 'month', 'last', 'this', 'on', 'for', 'about', 'from', 'to', 'with', 'at',
  'in', 'of', 'problems', 'problem', 'issues', 'issue', 'error', 'codes', 'code', 'shift', 'line', 'model',
  'models', 'part', 'parts', 'cost', 'center', 'checkpoint', 'vehicles', 'vehicle', 'rework', 'reworked',
  'downtime', 'maintenance', 'show', 'create', 'remind', 'reminder', 'reply', 'draft', 'inbox', 'unread',
  'emails', 'email', 'calendar', 'appointments', 'briefing', 'measure', 'need', 'know', 'morning', 'hello',
  'hi', 'hey', 'good', 'can', 'you', 'please', 'give', 'summarize', 'summarise', 'happened', 'much',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'call', 'supplier', 'find',
  'escalate', 'trigger', 'launch', 'distribute', 'flow', 'workflow', 'report', 'quality',
]);

/** German when German function and domain words outnumber the English ones. */
export const detectLanguage = (text) => {
  const tokens = String(text ?? '')
    .toLowerCase()
    .split(/[^a-zäöüß]+/)
    .filter(Boolean);
  let de = 0;
  let en = 0;
  for (const token of tokens) {
    if (GERMAN_WORDS.has(token)) de += 1;
    if (ENGLISH_WORDS.has(token)) en += 1;
  }
  // Umlauts and ß are a strong signal on their own.
  if (/[äöüß]/.test(String(text ?? '').toLowerCase())) de += 2;
  return de > en ? 'de' : 'en';
};

// ---- periods ----------------------------------------------------------------

const capitalise = (value) => value.replace(/^./, (character) => character.toUpperCase());

/** Resolves the time expression in a question into an inclusive date range. */
const extractTimeframe = (text, language = 'en') => {
  const today = now();
  const day = (date, key, expression) => {
    const iso = toIsoDate(date);
    return { from: iso, to: iso, label: t(language, key, { date: iso }), expression };
  };

  const isoMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch) {
    return { from: isoMatch[1], to: isoMatch[1], label: isoMatch[1], expression: isoMatch[1] };
  }

  const dayMonth = text.match(
    /\b(\d{1,2})(?:st|nd|rd|th|\.)?\s+(january|february|march|april|may|june|july|august|september|october|november|december|januar|februar|märz|maerz|juni|juli|oktober|dezember)\b/,
  );
  if (dayMonth) {
    const name = dayMonth[2].replace('maerz', 'märz');
    const month = (MONTHS.indexOf(name) >= 0 ? MONTHS.indexOf(name) : MONTHS_DE.indexOf(name)) + 1;
    const dayPart = String(dayMonth[1]).padStart(2, '0');
    const year = today.getUTCFullYear();
    const iso = `${year}-${String(month).padStart(2, '0')}-${dayPart}`;
    return { from: iso, to: iso, label: iso, expression: dayMonth[0] };
  }

  if (/\bday before yesterday\b|\bvorgestern\b/.test(text)) {
    return day(addDays(today, -2), 'period.dayBefore', 'day before yesterday');
  }
  if (/\byesterday\b|\bgestern\b/.test(text)) {
    return day(addDays(today, -1), 'period.yesterday', 'yesterday');
  }
  if (/\btoday\b|\bheute\b|\btonight\b/.test(text)) {
    return day(today, 'period.today', 'today');
  }
  // "morgen" is "tomorrow" unless it is the morning ("guten morgen", "heute morgen").
  if (/\btomorrow\b/.test(text) || /(?<!guten |heute |am |im )\bmorgen\b/.test(text)) {
    return day(addDays(today, 1), 'period.tomorrow', 'tomorrow');
  }

  if (/\blast week\b|\bletzte woche\b|\bvorige woche\b|\bvergangene woche\b/.test(text)) {
    const from = toIsoDate(addDays(today, -13));
    const to = toIsoDate(addDays(today, -7));
    return { from, to, label: t(language, 'period.lastWeek', { from, to }), expression: 'last week' };
  }

  if (/\bthis week\b|\bdiese woche\b|\bdieser woche\b/.test(text)) {
    const from = toIsoDate(addDays(today, -today.getUTCDay() + 1));
    const to = toIsoDate(today);
    return { from, to, label: t(language, 'period.thisWeek', { from, to }), expression: 'this week' };
  }

  const lastN =
    text.match(/\blast (\d{1,2}) (day|days|week|weeks)\b/) ??
    text.match(/\bletzten (\d{1,2}) (tag|tage|tagen|woche|wochen)\b/);
  if (lastN) {
    const amount = Number(lastN[1]);
    const days = /^(week|woche)/.test(lastN[2]) ? amount * 7 : amount;
    const from = toIsoDate(addDays(today, -(days - 1)));
    const to = toIsoDate(today);
    return { from, to, label: t(language, 'period.lastDays', { days }), expression: lastN[0] };
  }

  if (/\blast month\b|\bthis month\b|\bpast month\b|\bletzte[nr]? monat\b|\bdiese[nr]? monat\b|\bvergangene[nr]? monat\b/.test(text)) {
    const from = toIsoDate(addDays(today, -27));
    const to = toIsoDate(today);
    return { from, to, label: t(language, 'period.month'), expression: 'month' };
  }

  const weekdayMatch = text.match(
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/,
  );
  if (weekdayMatch) {
    const englishName = WEEKDAYS_DE[weekdayMatch[1]] ?? weekdayMatch[1];
    const date = lastWeekday(englishName, today);
    if (date) {
      const iso = toIsoDate(date);
      return {
        from: iso,
        to: iso,
        label: dateLabel(iso, language),
        expression: weekdayMatch[1],
      };
    }
  }

  return null;
};

const extractShift = (text) => {
  // The periods the client demonstrated, written any of the usual ways:
  // "06:00-14:00", "between 06:00 and 14:00", "0600 until 1400".
  const span = String.raw`\s*(?:-|–|to|until|and|bis|und)\s*`;
  if (new RegExp(String.raw`\b06:?00${span}14:?00\b`).test(text)) return 'S1';
  if (new RegExp(String.raw`\b14:?00${span}22:?00\b`).test(text)) return 'S2';
  if (new RegExp(String.raw`\b22:?00${span}06:?00\b`).test(text)) return 'S3';
  if (/\b(early|first|morning) shift\b|fr(ü|ue)hschicht|fr(ü|ue)he schicht|erste schicht/.test(text)) return 'S1';
  if (/\b(late|second|afternoon) shift\b|sp(ä|ae)tschicht|sp(ä|ae)te schicht|zweite schicht/.test(text)) return 'S2';
  if (/\b(night|third) shift\b|nachtschicht|dritte schicht/.test(text)) return 'S3';
  const explicit = text.match(/\b(?:shift|schicht) ([123])\b|\bs([123])\b/);
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

/** German shop-floor names for the lines the catalog knows. */
const LINE_ALIASES = {
  BS1: ['rohbau', 'karosseriebau', 'body shop'],
  PL2: ['lackierlinie', 'lackiererei', 'lackierung', 'paint line', 'paint shop'],
  FA1: ['endmontage 1', 'montage 1', 'final assembly 1'],
  FA2: ['endmontage 2', 'montage 2', 'final assembly 2'],
};

const SEVERITY_DE = { kritisch: 'critical', hoch: 'high', mittel: 'medium', niedrig: 'low', gering: 'low' };

// ---- secretary entities -----------------------------------------------------

const mailFilterFor = (text) => {
  if (/\bunread\b|\bungelesen/.test(text)) return 'unread';
  if (/\bflagged\b|\bmarkiert/.test(text)) return 'flagged';
  if (/\b(need|needs|needing|waiting for|require|requires) (a |an )?(reply|answer|response)\b|\bunanswered\b|\bbeantwort|\bantwort\b|\bunbeantwortet/.test(text)) {
    return 'needsReply';
  }
  return 'all';
};

const MAIL_STOPWORDS = new Set([
  'find', 'search', 'look', 'locate', 'show', 'me', 'my', 'the', 'a', 'an', 'for', 'e-mail', 'email', 'emails',
  'e-mails', 'mail', 'mails', 'message', 'messages', 'from', 'about', 'regarding', 'on', 'with', 'in', 'inbox',
  'please', 'suche', 'such', 'finde', 'find', 'zeige', 'zeig', 'mir', 'bitte', 'die', 'den', 'der', 'das', 'eine',
  'alle', 'nachricht', 'nachrichten', 'von', 'über', 'ueber', 'zu', 'wegen', 'mit', 'suchen', 'finden', 'zeigen',
  'anzeigen', 'nach', 'im', 'posteingang', 'that', 'which', 'of', 'to', 'and', 'und',
  // Reply triggers, so "draft a reply to the supplier email" searches for "supplier".
  'draft', 'write', 'reply', 'answer', 'respond', 'response', 'this', 'antworte', 'antworten', 'antwort',
  'auf', 'an', 'entwirf', 'entwerfe', 'schreib', 'schreibe', 'verfasse', 'antwortentwurf', 'entwerfen',
]);

/** Free-text mailbox query: the question minus its trigger words. */
const mailQueryFor = (text) =>
  text
    .replace(/[?!.,;:]/g, ' ')
    .split(/\s+/)
    .filter((token) => token && !MAIL_STOPWORDS.has(token))
    .join(' ')
    .trim();

const calendarDayFor = (text) => {
  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  if (/\btomorrow\b/.test(text) || /(?<!guten |heute |am |im )\bmorgen\b/.test(text)) return 'tomorrow';
  return 'today';
};

/**
 * Which approved flow a TRIGGER_FLOW question refers to. Keyword mapping onto
 * the built-in sample flow names; the tool resolves this reference against the
 * live catalog (fuzzy), so a canonical name here matches a sample flow exactly
 * and still gives a custom catalog something to match on. null when nothing is
 * named, which the tool turns into "which flow do you mean?".
 */
const FLOW_KEYWORDS = [
  { ref: 'escalate-quality-issue', pattern: /quality|qualit(ä|ae)t|escalat|eskalier/ },
  { ref: 'request-maintenance-visit', pattern: /maintenance|wartung|instandhaltung/ },
  { ref: 'daily-report-distribution', pattern: /report|bericht/ },
];

const flowRefFor = (text) => FLOW_KEYWORDS.find((entry) => entry.pattern.test(text))?.ref ?? null;

const MEASURE_NOISE = [
  /\b(what|how high|how much|how big|where|tell me|show me|show|give me|get)\b/g,
  /\b(is|was|are|the|our|current|value|of|for|in|from|on|according to|please|me|a|an|my)\b/g,
  /\bpower ?bi\b/g,
  /\b(measure|kpi|figure|number|report|dashboard)\b/g,
  /\b(wie hoch|was|wo|zeig|zeige|gib|sag|sage)\b/g,
  /\b(ist|war|sind|steht|die|der|das|den|unsere?|aktuelle[rn]?|wert|mir|bitte|aus|laut|in|für|fuer|von|im|zu)\b/g,
  /\b(kennzahl|messwert|zahl|bericht)\b/g,
  /\b(today|yesterday|tomorrow|this week|last week|this month|last month|heute|gestern|morgen|diese woche|letzte woche|diesen monat|letzten monat)\b/g,
];

/** The measure name the user asked for, stripped of the question around it. */
const measureQueryFor = (text) => {
  let query = ` ${text.replace(/[?!.,;:]/g, ' ')} `;
  for (const pattern of MEASURE_NOISE) query = query.replace(pattern, ' ');
  return query.replace(/\s+/g, ' ').trim();
};

/** Title from the original (cased) wording after "dashboard for ...". */
const dashboardTitleFor = (original) => {
  const match =
    original.match(/\bdashboard (?:for|of|about|showing|with|für|fuer|zu|mit|über|ueber)\s+(.+?)[?!.]*$/i) ??
    original.match(/\bdashboard\s*[:-]\s*(.+?)[?!.]*$/i);
  if (match && match[1].trim()) return capitalise(match[1].trim());
  return `Dashboard ${toIsoDate(now())}`;
};

// ---- entry point --------------------------------------------------------------

/**
 * @param {string} question
 * @param {{ language?: 'en'|'de' }} [options] force the language instead of detecting it
 */
export const parseQuestion = (question, options = {}) => {
  const original = String(question ?? '').trim();
  const text = original.toLowerCase();
  const language = options.language ? normalizeLanguage(options.language) : detectLanguage(text);
  const matched = [];

  for (const rule of INTENT_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      matched.push(rule.intent);
    }
  }

  const timeframe = extractTimeframe(text, language);
  const shiftId = extractShift(text);

  // Full line names first ("Final Assembly 2"), then the shared area names
  // ("Final Assembly"), so the area never shadows a more specific line.
  const line =
    findByName(text, LINES, (item) => LINE_ALIASES[item.id] ?? []) ??
    findByName(text, LINES, (item) => [item.area]) ??
    (text.match(/\b(?:line|linie) ([1-4])\b/) ? LINES[Number(text.match(/\b(?:line|linie) ([1-4])\b/)[1]) - 1] : null);
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
  // "wie hoch ist ..." asks "how high", it does not name the high severity.
  const severityText = text.replace(/\bwie hoch\b/g, ' ');
  const severity =
    SEVERITIES.find((value) => new RegExp(`\\b${value}\\b`).test(severityText)) ??
    Object.entries(SEVERITY_DE).find(([word]) => new RegExp(`\\b${word}(e|en|er|es)?\\b`).test(severityText))?.[1] ??
    null;

  // Dimension filters sharpen almost any intent; a question that names only a
  // line still reads as "what happened on that line".
  let intent = matched[0] ?? INTENTS.UNKNOWN;
  if (intent === INTENTS.CREATE_REMINDER && !isReminderRequest(original) && !/\berinner/.test(text)) {
    intent = matched[1] ?? INTENTS.UNKNOWN;
  }
  if (intent === INTENTS.UNKNOWN) {
    if (errorCodeEntry || part || checkpoint || model) intent = INTENTS.ISSUE_SUMMARY;
    else if (line) intent = INTENTS.LINE_ISSUES;
    else if (timeframe || shiftId) intent = INTENTS.DAILY_SUMMARY;
  }

  // Automation reference and any payload hints already parsed from the
  // question (an error code, a line, a model), only for a trigger request.
  const flowRef = intent === INTENTS.TRIGGER_FLOW ? flowRefFor(text) : null;
  const flowPayload = {};
  if (intent === INTENTS.TRIGGER_FLOW) {
    if (errorCodeEntry) flowPayload.errorCode = errorCodeEntry.code;
    if (line) flowPayload.lineId = line.id;
    if (model) flowPayload.modelId = model.id;
    if (shiftId) flowPayload.shiftId = shiftId;
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
    // Secretary entities; null unless the intent needs them.
    mailFilter: [INTENTS.INBOX_SUMMARY, INTENTS.MAIL_SEARCH, INTENTS.DRAFT_REPLY].includes(intent) ? mailFilterFor(text) : null,
    mailQuery: [INTENTS.MAIL_SEARCH, INTENTS.DRAFT_REPLY].includes(intent) ? mailQueryFor(text) : null,
    calendarDay: intent === INTENTS.CALENDAR_TODAY ? calendarDayFor(text) : null,
    reminder: intent === INTENTS.CREATE_REMINDER ? parseReminder(original) : null,
    measureQuery: intent === INTENTS.POWERBI_MEASURE ? measureQueryFor(text) : null,
    dashboardTitle: intent === INTENTS.CREATE_DASHBOARD ? dashboardTitleFor(original) : null,
    flow: flowRef,
    flowPayload: intent === INTENTS.TRIGGER_FLOW ? flowPayload : null,
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
    entities.reminder && 'reminder',
    entities.measureQuery && 'measure',
    entities.mailQuery && 'mail query',
    flowRef && 'flow',
  ].filter(Boolean);

  const confidence =
    intent === INTENTS.UNKNOWN
      ? 0.2
      : Math.min(0.98, 0.55 + matched.length * 0.12 + signals.length * 0.07);

  return {
    question,
    language,
    intent,
    alternateIntents: matched.filter((entry) => entry !== intent),
    entities,
    signals,
    confidence: Number(confidence.toFixed(2)),
    // When no period is named, the assistant answers for the most recent
    // production day rather than silently scanning everything.
    resolvedTimeframe:
      timeframe ?? {
        from: toIsoDate(now()),
        to: toIsoDate(now()),
        label: t(language, 'period.assumed', { date: toIsoDate(now()) }),
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

const SHIFT_NAMES_DE = { S1: 'Frühschicht', S2: 'Spätschicht', S3: 'Nachtschicht' };

export const describeShift = (shiftId, language = 'en') => {
  const shift = SHIFTS.find((entry) => entry.id === shiftId);
  if (!shift) return shiftId;
  const name = language === 'de' ? SHIFT_NAMES_DE[shift.id] ?? shift.name : shift.name;
  return `${name} (${shift.label})`;
};

export const describeDate = (iso, language = 'en') => {
  try {
    if (language === 'de') return dateLabel(iso, 'de');
    return `${weekdayName(parseIsoDate(iso)).replace(/^./, (c) => c.toUpperCase())} ${iso}`;
  } catch {
    return iso;
  }
};
