import { dateLabel, normalizeLanguage } from '../agent/i18n.js';
import { translateDashboardText } from '../agent/llm.js';
import { labelFor } from '../agent/labels.js';
import { addDays, now, parseIsoDate, toIsoDate } from '../utils/dates.js';
import { localizeWidgetTitle } from './builder.js';
import { saveDashboard } from './store.js';

/**
 * Presents a saved dashboard in the viewer's language.
 *
 * Two kinds of text live on a dashboard. Widget titles are system strings,
 * re-derived deterministically from each widget's stored query so they always
 * match the UI language at no cost. The dashboard's own name, the question it
 * was built from and the period label are free text; they are localized in
 * three tiers, best first:
 *   1. a cached translation (from a previous AI call),
 *   2. a live Claude translation when the model is enabled (cached for next time),
 *   3. a deterministic name generated from the dashboard's own structure
 *      (metrics + line + period) - works with no API key.
 * Only AI translations are cached, so turning Claude on later upgrades a name
 * that is currently generated offline. When none of the tiers apply (an
 * unrecognized free-text question with no production signal), the original
 * strings stand - localization never blocks a dashboard from loading.
 */

const srcLanguageOf = (dashboard) => normalizeLanguage(dashboard.language ?? 'en');

// German line names; the catalog stores only English ones (labelFor is not
// language-aware), and these four are the whole plant.
const LINE_DE = {
  BS1: 'Karosseriebau Linie 1',
  PL2: 'Lackierlinie 2',
  FA1: 'Endmontage 1',
  FA2: 'Endmontage 2',
};

const lineName = (id, lang) => (lang === 'de' ? LINE_DE[id] ?? labelFor('lineId', id) : labelFor('lineId', id));

const daysInclusive = (from, to) => Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / 86400000) + 1;

/** A localized phrase for a period, from its dates relative to today. */
const describePeriod = (from, to, lang) => {
  if (!from || !to) return '';
  const de = lang === 'de';
  const today = toIsoDate(now());
  const yesterday = toIsoDate(addDays(now(), -1));
  const dayBefore = toIsoDate(addDays(now(), -2));
  if (from === to) {
    if (from === today) return de ? 'heute' : 'today';
    if (from === yesterday) return de ? 'gestern' : 'yesterday';
    if (from === dayBefore) return de ? 'vorgestern' : 'the day before yesterday';
    return dateLabel(from, lang);
  }
  const days = daysInclusive(from, to);
  if (to === today) return de ? `die letzten ${days} Tage` : `the last ${days} days`;
  return `${dateLabel(from, lang)} – ${dateLabel(to, lang)}`;
};

/**
 * A deterministic, localized dashboard name built from what the dashboard
 * actually shows. Returns null for a question with no production signal (so the
 * original free text stands rather than a misleading generic name).
 * @returns {{ name: string, periodLabel: string } | null}
 */
const generateDashboardName = (dashboard, language) => {
  const lang = normalizeLanguage(language);
  const de = lang === 'de';
  const text = String(dashboard.question ?? '').toLowerCase();

  const wantsCodes = /error code|fehlercode|codes?\b/.test(text);
  const wantsDowntime = /downtime|stillstand|ausfall|stop/.test(text);
  const wantsRework = /rework|nacharbeit/.test(text);

  const lineId = dashboard.filter?.lineId ?? null;
  const hasLine = Boolean(lineId);

  // Pick the leading subject from what the question emphasised. Every dashboard
  // carries default KPIs, so emphasis must come from the question, not the
  // widget set. A generic subject is dropped when a line names the dashboard.
  let topic = null;
  let generic = false;
  if (wantsRework && wantsDowntime) topic = de ? 'Nacharbeit & Stillstand' : 'Rework & downtime';
  else if (wantsRework) topic = de ? 'Nacharbeit' : 'Rework';
  else if (wantsDowntime) topic = de ? 'Stillstand' : 'Downtime';
  else if (wantsCodes) topic = de ? 'Fehlercodes' : 'Error codes';
  else {
    topic = de ? 'Produktionsprobleme' : 'Production issues';
    generic = true;
  }

  // No recognizable production signal at all: leave the user's words alone.
  if (generic && !hasLine) return null;

  const periodLabel = describePeriod(dashboard.period?.from, dashboard.period?.to, lang);
  const parts = [];
  if (!(generic && hasLine)) parts.push(topic); // drop a bare generic subject beside a line
  if (hasLine) parts.push(lineName(lineId, lang));
  if (periodLabel) parts.push(periodLabel);

  return { name: parts.join(' · '), periodLabel };
};

/**
 * Resolves the free-text strings (title, question, period label) for a language,
 * caching only AI translations on the stored dashboard.
 * @returns {Promise<{ title: string, question: string, periodLabel: string }>}
 */
export const resolveDashboardText = async (dashboard, language) => {
  const lang = normalizeLanguage(language);
  const base = {
    title: dashboard.title ?? '',
    question: dashboard.question ?? '',
    periodLabel: dashboard.period?.label ?? '',
  };
  if (lang === srcLanguageOf(dashboard)) return base;

  const cached = dashboard.translations?.[lang];
  if (cached) return { ...base, ...cached };

  // Tier 2: live Claude translation (cached for next time, and for other viewers).
  const translated = await translateDashboardText({ texts: base, language: lang });
  if (translated) {
    const resolved = { ...base, ...translated };
    dashboard.translations = { ...(dashboard.translations ?? {}), [lang]: resolved };
    saveDashboard(dashboard);
    return resolved;
  }

  // Tier 3: deterministic offline name (NOT cached, so AI upgrades it later).
  const generated = generateDashboardName(dashboard, lang);
  if (generated) return { title: generated.name, question: generated.name, periodLabel: generated.periodLabel };

  return base;
};

/** Re-derives every widget title in `target` (a dashboard copy) for the language. */
export const localizeWidgetTitles = (target, language) => {
  for (const widget of target.widgets ?? []) {
    const title = localizeWidgetTitle(widget.query, language);
    if (title) widget.title = title;
  }
  return target;
};

/**
 * A full dashboard (already refreshed/cloned) presented in the language:
 * localized widget titles plus a localized name, question and period label.
 */
export const localizeDashboard = async (stored, target, language) => {
  localizeWidgetTitles(target, language);
  const text = await resolveDashboardText(stored, language);
  target.title = text.title || target.title;
  target.question = text.question || target.question;
  if (target.period) target.period = { ...target.period, label: text.periodLabel || target.period.label };
  return target;
};
