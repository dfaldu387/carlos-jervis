import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

process.env.JERVIS_TASKS_FILE = join(tmpdir(), `jervis-tasks-${randomUUID()}.json`);
process.env.JERVIS_DASHBOARDS_FILE = join(tmpdir(), `jervis-dash-${randomUUID()}.json`);
process.env.JERVIS_INTEGRATIONS_FILE = join(tmpdir(), `jervis-int-${randomUUID()}.json`);

const { INTENTS, parseQuestion, detectLanguage } = await import('../src/agent/nlu.js');
const { answerQuestion } = await import('../src/agent/orchestrator.js');
const { resolveAccess } = await import('../src/security/roles.js');
const { t } = await import('../src/agent/i18n.js');
const { createApp } = await import('../src/app.js');
const { now, toIsoDate, addDays } = await import('../src/utils/dates.js');

const manager = resolveAccess('manager');

describe('German understanding', () => {
  test('detects the language from the wording', () => {
    assert.equal(detectLanguage('Welche Probleme hatten wir am Freitag?'), 'de');
    assert.equal(detectLanguage('What problems did we have on Friday?'), 'en');
    assert.equal(parseQuestion('Posteingang').language, 'de');
    assert.equal(parseQuestion('inbox').language, 'en');
    assert.equal(parseQuestion('hello', { language: 'de' }).language, 'de', 'a forced language wins');
  });

  test('recognises the production intents with German trigger words', () => {
    const cases = [
      ['Welche Probleme hatten wir am Freitag?', INTENTS.ISSUE_SUMMARY],
      ['Welche Fehlercodes traten diese Woche auf?', INTENTS.TOP_ERROR_CODES],
      ['Wie viele Fahrzeuge wurden gestern nachgearbeitet?', INTENTS.REWORK_COUNT],
      ['Wie viele Fahrzeuge waren betroffen?', INTENTS.VEHICLE_COUNT],
      ['Wie viel Stillstand hatten wir letzte Woche?', INTENTS.DOWNTIME],
      ['Gibt es offene Wartungstickets?', INTENTS.MAINTENANCE_STATUS],
      ['Welche Linie hatte die meisten Probleme?', INTENTS.LINE_ISSUES],
      ['Welche Modelle waren betroffen?', INTENTS.AFFECTED_MODELS],
      ['Welche Teile waren beteiligt?', INTENTS.PARTS_INVOLVED],
      ['Welche Prüfpunkte haben die Probleme erkannt?', INTENTS.CHECKPOINT_DETECTION],
      ['Wie ist die Kostenstellenauswirkung?', INTENTS.COST_CENTER_IMPACT],
      ['Fasse die Frühschicht von gestern zusammen', INTENTS.SHIFT_SUMMARY],
      ['Was ist gestern passiert?', INTENTS.DAILY_SUMMARY],
    ];
    for (const [question, intent] of cases) {
      const result = parseQuestion(question);
      assert.equal(result.intent, intent, question);
      assert.equal(result.language, 'de', question);
    }
  });

  test('understands German periods and shifts', () => {
    const today = now();
    assert.equal(parseQuestion('Probleme heute').entities.timeframe.from, toIsoDate(today));
    assert.equal(parseQuestion('Probleme gestern').entities.timeframe.from, toIsoDate(addDays(today, -1)));
    assert.equal(parseQuestion('Probleme vorgestern').entities.timeframe.from, toIsoDate(addDays(today, -2)));
    const lastWeek = parseQuestion('Probleme letzte Woche').entities.timeframe;
    assert.ok(lastWeek.from < lastWeek.to);
    assert.match(lastWeek.label, /^letzte Woche/);
    assert.match(parseQuestion('Probleme diese Woche').entities.timeframe.label, /^diese Woche/);
    assert.match(parseQuestion('Probleme letzten Monat').entities.timeframe.label, /28 Tage/);
    const monday = parseQuestion('Probleme am Montag').entities.timeframe;
    assert.equal(new Date(`${monday.from}T00:00:00Z`).getUTCDay(), 1);
    assert.match(monday.label, /^Montag/);
    assert.equal(parseQuestion('Frühschicht gestern').entities.shiftId, 'S1');
    assert.equal(parseQuestion('Spätschicht gestern').entities.shiftId, 'S2');
    assert.equal(parseQuestion('Nachtschicht gestern').entities.shiftId, 'S3');
    assert.equal(parseQuestion('Probleme auf Linie 2').entities.lineId, 'PL2');
    assert.equal(parseQuestion('kritische Probleme gestern').entities.severity, 'critical');
    assert.equal(parseQuestion('Wie hoch ist die Nacharbeitsquote?').entities.severity, null, '"wie hoch" is not a severity');
  });

  test('recognises the secretary intents in German', () => {
    assert.equal(parseQuestion('Posteingang').intent, INTENTS.INBOX_SUMMARY);
    assert.equal(parseQuestion('ungelesene E-Mails').entities.mailFilter, 'unread');
    assert.equal(parseQuestion('E-Mail von Nordkabel suchen').intent, INTENTS.MAIL_SEARCH);
    assert.equal(parseQuestion('meine Termine heute').intent, INTENTS.CALENDAR_TODAY);
    assert.equal(parseQuestion('meine Termine morgen').entities.calendarDay, 'tomorrow');
    assert.equal(parseQuestion('Tagesbriefing').intent, INTENTS.DAILY_BRIEFING);
    assert.equal(parseQuestion('was steht heute an').intent, INTENTS.DAILY_BRIEFING);
    const reminder = parseQuestion('erinnere mich morgen um 9 daran, den Lieferanten anzurufen');
    assert.equal(reminder.intent, INTENTS.CREATE_REMINDER);
    assert.equal(reminder.entities.reminder.dueAt, `${toIsoDate(addDays(now(), 1))}T09:00:00.000Z`);
    assert.equal(parseQuestion('antworte auf die E-Mail von Nordkabel').intent, INTENTS.DRAFT_REPLY);
    assert.equal(parseQuestion('Kennzahl OEE aus Power BI').intent, INTENTS.POWERBI_MEASURE);
    assert.equal(parseQuestion('erstelle ein Dashboard für Fehlercodes diese Woche').intent, INTENTS.CREATE_DASHBOARD);
  });

  test('the English intents are unchanged', () => {
    assert.equal(parseQuestion('What problems did we have on Friday?').intent, INTENTS.ISSUE_SUMMARY);
    assert.equal(parseQuestion('Which Power BI report has the rework figures?').intent, INTENTS.DASHBOARD_LOOKUP);
    assert.equal(parseQuestion("what's in my inbox").intent, INTENTS.INBOX_SUMMARY);
    assert.equal(parseQuestion('remind me to call the supplier tomorrow at 9').intent, INTENTS.CREATE_REMINDER);
    assert.equal(parseQuestion('what is the OEE in Power BI').intent, INTENTS.POWERBI_MEASURE);
    assert.equal(parseQuestion('create a dashboard for paint line issues this week').intent, INTENTS.CREATE_DASHBOARD);
  });
});

describe('German narration', () => {
  test('t() falls back to English and picks plural forms', () => {
    assert.equal(t('de', 'count.issue', { count: 1 }), '1 Problem');
    assert.equal(t('de', 'count.issue', { count: 3 }), '3 Probleme');
    assert.equal(t('en', 'count.issue', { count: 3 }), '3 issues');
    assert.equal(t('de', 'nope.key'), 'nope.key');
  });

  test('conversational answers come back in German', async () => {
    const greeting = await answerQuestion({ question: 'hallo', access: manager });
    assert.equal(greeting.language, 'de');
    assert.match(greeting.answer.headline, /^Guten (Morgen|Tag|Abend), sir!$/);
    assert.match(greeting.answer.narrative[0], /^Was möchten Sie wissen\?/);

    const capabilities = await answerQuestion({ question: 'was kannst du?', access: manager });
    assert.match(capabilities.answer.headline, /Was ich heute beantworten kann/);

    const unknown = await answerQuestion({ question: 'xyzzy', access: manager, language: 'de' });
    assert.equal(unknown.language, 'de');
    assert.match(unknown.answer.headline, /Dazu brauche ich etwas mehr/);
  });

  test('production answers are narrated in German with the same figures', async () => {
    const de = await answerQuestion({ question: 'Welche Probleme hatten wir am Freitag?', access: manager });
    const en = await answerQuestion({ question: 'What problems did we have on Friday?', access: manager });
    assert.equal(de.language, 'de');
    assert.match(de.answer.headline, /Probleme erfasst am Freitag/);
    assert.match(de.answer.narrative[0], /^Am Freitag .* gab es \d+ Problemereignisse/);
    const number = (text) => Number(text.match(/(\d+) /)[1]);
    assert.equal(number(de.answer.headline), number(en.answer.headline), 'same count in both languages');
    assert.match(de.answer.spoken, /Stunden|Minuten|Problemereignisse/);

    const daily = await answerQuestion({ question: 'Was ist gestern passiert?', access: manager });
    assert.match(daily.answer.narrative[0], /enthält die Problemhistorie/);
    assert.ok(daily.answer.bullets.some((bullet) => /Stärkste Schicht: (Früh|Spät|Nacht)schicht/.test(bullet.text)));

    const codes = await answerQuestion({ question: 'Welche Fehlercodes traten diese Woche auf?', access: manager });
    assert.match(codes.answer.headline, /Fehlercodes? für diese Woche/);

    const lines = await answerQuestion({ question: 'Welche Linie hatte gestern die meisten Probleme?', access: manager });
    assert.match(lines.answer.headline, /hatte die meisten Probleme am/);

    const shift = await answerQuestion({ question: 'Fasse die Frühschicht von gestern zusammen', access: manager });
    assert.match(shift.answer.headline, /Frühschicht \(06:00-14:00\)/);
    assert.ok(shift.answer.followUps.every((text) => /[a-zäöü]/i.test(text)));
    assert.match(shift.answer.followUps[0], /Spätschicht/);
  });

  test('secretary answers are narrated in German', async () => {
    const inbox = await answerQuestion({ question: 'Posteingang', access: manager });
    assert.match(inbox.answer.headline, /ungelesen, \d+ warten auf eine Antwort/);

    const calendar = await answerQuestion({ question: 'meine Termine heute', access: manager });
    assert.match(calendar.answer.headline, /Termine? heute/);

    const briefing = await answerQuestion({ question: 'Tagesbriefing', access: manager });
    assert.match(briefing.answer.headline, /^Ihr Briefing für/);
    assert.equal(briefing.briefing.sections[0].title, 'Kalender');

    const reminder = await answerQuestion({ question: 'erinnere mich morgen um 9 daran, den Lieferanten anzurufen', access: manager });
    assert.match(reminder.answer.headline, /^Erinnerung gesetzt/);

    const dashboard = await answerQuestion({ question: 'erstelle ein Dashboard für Fehlercodes diese Woche', access: manager });
    assert.match(dashboard.answer.headline, /^Dashboard erstellt/);
    assert.equal(dashboard.dashboard.widgets[0].title, 'Betroffene Fahrzeuge');

    const measure = await answerQuestion({ question: 'Kennzahl OEE aus Power BI', access: manager });
    assert.match(measure.answer.narrative[0], /beträgt .* Power-BI-Bericht/);

    const withheld = await answerQuestion({ question: 'Posteingang', access: resolveAccess('viewer') });
    assert.match(withheld.answer.headline, /Für Ihre Rolle nicht verfügbar/);
  });
});

describe('German over HTTP', () => {
  let server;
  let baseUrl;

  before(async () => {
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server?.close());

  const call = async (path, options = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: { 'content-type': 'application/json', 'x-jervis-role': 'manager', ...(options.headers ?? {}) },
    });
    return { status: response.status, body: await response.json() };
  };

  test('chat reports the language and honours an override', async () => {
    const detected = await call('/api/chat', { method: 'POST', body: JSON.stringify({ message: 'Welche Probleme hatten wir gestern?' }) });
    assert.equal(detected.body.language, 'de');

    const forced = await call('/api/chat', { method: 'POST', body: JSON.stringify({ message: 'What problems did we have yesterday?', language: 'de' }) });
    assert.equal(forced.body.language, 'de');
    assert.match(forced.body.answer.headline, /Probleme erfasst/);

    const english = await call('/api/chat', { method: 'POST', body: JSON.stringify({ message: 'What problems did we have yesterday?' }) });
    assert.equal(english.body.language, 'en');
  });

  test('voice config switches to German wording and wake prefixes', async () => {
    const { body } = await call('/api/voice/config?language=de');
    assert.equal(body.language, 'de');
    assert.match(body.greetingNow, /^Guten (Morgen|Tag|Abend), sir! Was möchten Sie wissen\?$/);
    assert.equal(body.greeting.prompt, 'Was möchten Sie wissen?');
    assert.match(body.notUnderstood, /Produktionsfrage/);
    assert.match(body.silence, /nichts gehört/);
    for (const prefix of ['hallo', 'hey', 'he', 'ok']) assert.ok(body.wake.prefixes.includes(prefix), prefix);
    assert.ok(body.examples.some((example) => /Posteingang/.test(example)));

    const english = await call('/api/voice/config');
    assert.equal(english.body.language, 'en');
    assert.ok(!english.body.wake.prefixes.includes('hallo'));
  });
});
