import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

process.env.JERVIS_TASKS_FILE = join(tmpdir(), `jervis-tasks-${randomUUID()}.json`);
process.env.JERVIS_DASHBOARDS_FILE = join(tmpdir(), `jervis-dash-${randomUUID()}.json`);
process.env.JERVIS_INTEGRATIONS_FILE = join(tmpdir(), `jervis-int-${randomUUID()}.json`);

const { INTENTS, parseQuestion } = await import('../src/agent/nlu.js');
const { answerQuestion } = await import('../src/agent/orchestrator.js');
const { localizeRedactions } = await import('../src/agent/synthesizer.js');
const { resolveAccess } = await import('../src/security/roles.js');

const manager = resolveAccess('manager');
const viewer = resolveAccess('viewer');

/**
 * English words Jervis' own German wording never uses. Catalog names (lines,
 * models, error code descriptions, report titles) are English data and are
 * kept out of the questions below, so a headline carries only the template.
 */
const ENGLISH_HEADLINE =
  /\b(the|were|was|of|for|vehicles?|issues?|affected|reworked|involved|detected|maintenance|downtime|reports?|cover|trend|impact|parts?|models?|checkpoints?|recorded|across|hidden)\b/i;

/** Narrative paragraphs may quote catalog labels, so only function words are checked. */
const ENGLISH_PROSE = /\b(the|were|are|is|booked|totalling|peaking|mainly)\b/;

const ENGLISH_UNITS = /\b(hours?|minutes?)\b/;

const CASES = [
  [INTENTS.AFFECTED_MODELS, 'Welche Modelle waren gestern betroffen?'],
  [INTENTS.PARTS_INVOLVED, 'Welche Teile waren diese Woche beteiligt?'],
  [INTENTS.VEHICLE_COUNT, 'Wie viele Fahrzeuge waren gestern betroffen?'],
  [INTENTS.REWORK_COUNT, 'Wie viele Fahrzeuge wurden gestern nachgearbeitet?'],
  [INTENTS.CHECKPOINT_DETECTION, 'Welche Prüfpunkte haben diese Woche die Probleme erkannt?'],
  [INTENTS.COST_CENTER_IMPACT, 'Wie ist die Kostenstellenauswirkung diese Woche?'],
  [INTENTS.MAINTENANCE_STATUS, 'Gibt es diese Woche offene Wartungstickets?'],
  [INTENTS.DOWNTIME, 'Wie viel Stillstand hatten wir letzte Woche?'],
  [INTENTS.TREND, 'Zeig den Verlauf über die letzten 7 Tage'],
  [INTENTS.DASHBOARD_LOOKUP, 'Welcher Bericht in Power BI hat die Nacharbeitszahlen?'],
  // Already German before this round; kept so the whole production set is covered.
  [INTENTS.ISSUE_SUMMARY, 'Welche Probleme hatten wir am Freitag?'],
  [INTENTS.DAILY_SUMMARY, 'Was ist gestern passiert?'],
  [INTENTS.SHIFT_SUMMARY, 'Fasse die Frühschicht von gestern zusammen'],
  [INTENTS.TOP_ERROR_CODES, 'Welche Fehlercodes traten diese Woche auf?'],
  [INTENTS.LINE_ISSUES, 'Welche Linie hatte gestern die meisten Probleme?'],
];

describe('German narration for every production intent', () => {
  for (const [intent, question] of CASES) {
    test(`${intent}: "${question}"`, async () => {
      const result = await answerQuestion({ question, access: manager });
      const { answer } = result;

      assert.equal(result.language, 'de');
      assert.equal(result.interpretation.intent, intent);

      assert.ok(answer.headline.length > 0, 'headline present');
      assert.ok(!ENGLISH_HEADLINE.test(answer.headline), `English headline: ${answer.headline}`);
      for (const paragraph of answer.narrative) {
        assert.ok(!ENGLISH_PROSE.test(paragraph), `English narrative: ${paragraph}`);
      }
      for (const bullet of answer.bullets) {
        assert.ok(!ENGLISH_PROSE.test(bullet.text), `English bullet: ${bullet.text}`);
      }
      assert.ok(!ENGLISH_PROSE.test(answer.spoken), `English spoken form: ${answer.spoken}`);
      assert.ok(!ENGLISH_UNITS.test(answer.spoken), `English units spoken: ${answer.spoken}`);

      // KPI tiles, tables and charts carry German labels; the Power BI measure
      // tile keeps the measure's own name, which is data.
      for (const tile of answer.metrics) {
        if (tile.source === 'powerbi' && !['issues_total', 'first_pass_yield', 'rework_cost'].includes(tile.key)) continue;
        assert.ok(!ENGLISH_HEADLINE.test(tile.label), `English metric label: ${tile.label}`);
      }
      for (const table of answer.tables) {
        assert.ok(!ENGLISH_HEADLINE.test(table.title), `English table title: ${table.title}`);
        for (const column of table.columns) {
          assert.ok(!ENGLISH_HEADLINE.test(column.label), `English column: ${column.label}`);
        }
      }
      for (const chart of answer.charts) {
        assert.ok(!ENGLISH_HEADLINE.test(chart.title), `English chart title: ${chart.title}`);
      }
      for (const link of answer.links) {
        assert.ok(!/^Open /.test(link.label), `English link label: ${link.label}`);
      }

      // Every suggestion is a German question the NLU maps to a real intent.
      assert.equal(answer.followUps.length, 3);
      for (const followUp of answer.followUps) {
        const parsed = parseQuestion(followUp);
        assert.equal(parsed.language, 'de', `follow-up not German: ${followUp}`);
        assert.ok(
          ![INTENTS.GREETING, INTENTS.UNKNOWN].includes(parsed.intent),
          `follow-up "${followUp}" parsed to ${parsed.intent}`,
        );
      }
    });
  }

  test('the rework and downtime follow-ups land on the intended intents', async () => {
    const rework = await answerQuestion({ question: 'Wie viele Fahrzeuge wurden gestern nachgearbeitet?', access: manager });
    assert.deepEqual(
      rework.answer.followUps.map((text) => parseQuestion(text).intent),
      [INTENTS.REWORK_COUNT, INTENTS.COST_CENTER_IMPACT, INTENTS.LINE_ISSUES],
    );
    const downtime = await answerQuestion({ question: 'Wie viel Stillstand hatten wir letzte Woche?', access: manager });
    assert.deepEqual(
      downtime.answer.followUps.map((text) => parseQuestion(text).intent),
      [INTENTS.MAINTENANCE_STATUS, INTENTS.DOWNTIME, INTENTS.ISSUE_SUMMARY],
    );
  });

  test('figures and units come through the German formatters', async () => {
    const rework = await answerQuestion({ question: 'Wie viele Fahrzeuge wurden gestern nachgearbeitet?', access: manager });
    assert.match(rework.answer.headline, /^\d+ Fahrzeuge? nachgearbeitet am (Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag) \d{4}-\d{2}-\d{2}$/);
    assert.match(rework.answer.narrative[0], /Als Nacharbeitszeit wurden (\d+ Std\.|\d+ Min\.|\d+ Std\. \d+ Min\.) gebucht\.$/);
    assert.match(rework.answer.spoken, /Stunden?|Minuten?/);
    assert.ok(!/\.\./.test(rework.answer.narrative.join(' ')), 'no doubled full stop after "Min."');

    const downtime = await answerQuestion({ question: 'Wie viel Stillstand hatten wir letzte Woche?', access: manager });
    assert.match(downtime.answer.headline, /^(\d+ Std\.|\d+ Min\.|\d+ Std\. \d+ Min\.) Stillstand für letzte Woche/);
    assert.match(downtime.answer.narrative[0], /^\d+ Stillstandsereignis(se)? mit insgesamt .* wurden für letzte Woche .* an den Broker gemeldet\.$/);
    assert.ok(!/\.\./.test(downtime.answer.narrative.join(' ')), 'no doubled full stop after "Min."');

    const trend = await answerQuestion({ question: 'Zeig den Verlauf über die letzten 7 Tage', access: manager });
    assert.match(trend.answer.headline, /^Problemverlauf für die letzten 7 Tage$/);
    assert.match(trend.answer.narrative[0], /^Über \d+ Tage liegt der Durchschnitt bei \d+(,\d+)? Problemen pro Tag/);
    if (/Höchstwert/.test(trend.answer.narrative[0])) {
      assert.match(trend.answer.narrative[0], /am (Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag) \d{4}-\d{2}-\d{2}\./);
    }
  });

  test('empty periods fall back to German wording', async () => {
    const models = await answerQuestion({ question: 'Welche Modelle waren am 2020-01-01 betroffen?', access: manager });
    assert.match(models.answer.headline, /^0 Fahrzeugmodelle betroffen am/);
    assert.match(models.answer.narrative[0], /^Für .* waren keine Fahrzeugmodelle betroffen\.$/);

    const parts = await answerQuestion({ question: 'Welche Teile waren am 2020-01-01 beteiligt?', access: manager });
    assert.match(parts.answer.narrative[0], /keine Teile zu Problemen erfasst/);

    const checkpoints = await answerQuestion({ question: 'Welche Prüfpunkte haben am 2020-01-01 Probleme erkannt?', access: manager });
    assert.match(checkpoints.answer.narrative[0], /keine Erkennungen an Prüfpunkten erfasst/);
  });

  test('redaction reasons and withheld tools are explained in German', async () => {
    const result = await answerQuestion({ question: 'Wie ist die Kostenstellenauswirkung diese Woche?', access: viewer });
    assert.equal(result.language, 'de');
    assert.ok(result.answer.redactions.length > 0, 'the viewer must be told something was withheld');
    for (const entry of result.answer.redactions) {
      assert.ok(!/withheld|Cost figures|column\(s\)|identifiers|Supplier names/.test(entry.reason), entry.reason);
    }
    assert.ok(result.answer.redactions.some((entry) => /Kostenwerte|zurückgehalten|Fahrzeugkennungen|Lieferantennamen/.test(entry.reason)));
    assert.match(result.answer.narrative[0], /^Die Kostenwerte liegen im zugriffsbeschränkten Bericht/);
    for (const entry of result.withheld) {
      assert.ok(
        result.answer.bullets.some((bullet) => bullet.text === `${entry.label} zurückgehalten: Ihre Rolle hat die Berechtigung ${entry.permission} nicht`),
        `withheld bullet for ${entry.tool}`,
      );
      assert.ok(result.answer.redactions.some((item) => item.element === `tool:${entry.tool}` && /zurückgehalten/.test(item.reason)));
    }
  });

  test('localizeRedactions leaves English untouched and maps the German reasons', () => {
    const redactions = [
      { element: 'metric:rework_cost', reason: 'Cost figures and cost center breakdown' },
      { element: 'table:issue-records', reason: '2 column(s) withheld' },
      { element: 'table:issue-records', reason: '1 column(s) withheld' },
      { element: 'x', reason: 'Vehicle identifiers' },
      { element: 'y', reason: 'Supplier names' },
      { element: 'z', reason: 'Something custom' },
    ];
    assert.equal(localizeRedactions(redactions, 'en'), redactions, 'same array for English');
    assert.deepEqual(
      localizeRedactions(redactions, 'de').map((entry) => entry.reason),
      [
        'Kostenwerte und Kostenstellenaufschlüsselung',
        '2 Spalten zurückgehalten',
        '1 Spalte zurückgehalten',
        'Fahrzeugkennungen',
        'Lieferantennamen',
        'Something custom',
      ],
    );
  });

  test('English wording is unchanged', async () => {
    const rework = await answerQuestion({ question: 'How many vehicles were reworked yesterday?', access: manager });
    assert.equal(rework.language, 'en');
    assert.match(rework.answer.headline, /^\d+ vehicles reworked on /);
    assert.deepEqual(rework.answer.followUps, [
      'Which vehicles were removed from the line?',
      'What is the rework cost impact?',
      'Which line produced the most rework?',
    ]);
    assert.equal(rework.answer.metrics.find((tile) => tile.key === 'vehicles_reworked').label, 'Vehicles reworked');
    assert.ok(rework.answer.links.some((link) => /^Open /.test(link.label)));

    const downtime = await answerQuestion({ question: 'How much downtime was recorded last week?', access: manager });
    assert.match(downtime.answer.headline, /of downtime on last week/);
    assert.deepEqual(downtime.answer.followUps, [
      'What maintenance tickets were opened?',
      'Which line stopped the longest?',
      'What problems happened during the stops?',
    ]);
    assert.ok(downtime.answer.tables.some((table) => table.title === 'Downtime events (MQTT)'));

    const models = await answerQuestion({ question: 'Which models were affected yesterday?', access: manager });
    assert.match(models.answer.headline, /^\d+ vehicle models? affected on /);
    assert.ok(models.answer.tables.some((table) => table.title === 'Issues by vehicle model'));
  });
});
