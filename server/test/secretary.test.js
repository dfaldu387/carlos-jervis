import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Isolate the on-disk stores before any module reads them.
process.env.JERVIS_TASKS_FILE = join(tmpdir(), `jervis-tasks-${randomUUID()}.json`);
process.env.JERVIS_DASHBOARDS_FILE = join(tmpdir(), `jervis-dash-${randomUUID()}.json`);
process.env.JERVIS_INTEGRATIONS_FILE = join(tmpdir(), `jervis-int-${randomUUID()}.json`);
delete process.env.ELEVENLABS_API_KEY;

const { createApp } = await import('../src/app.js');
const { parseReminder } = await import('../src/secretary/reminders.js');
const { resetTasks } = await import('../src/secretary/tasks.js');
const { resetMailbox } = await import('../src/secretary/mailbox.js');
const { now, toIsoDate, addDays } = await import('../src/utils/dates.js');

let server;
let baseUrl;

const call = async (path, { role = 'manager', ...options } = {}) => {
  const headers = { 'content-type': 'application/json', ...(options.headers ?? {}) };
  if (role) headers['x-jervis-role'] = role;
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  return { status: response.status, body: await response.json().catch(() => ({})) };
};

describe('Secretary API', () => {
  before(async () => {
    resetTasks();
    resetMailbox();
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server?.close());

  test('requires a signed-in user', async () => {
    assert.equal((await call('/api/secretary/mail', { role: null })).status, 401);
    assert.equal((await call('/api/secretary/briefing', { role: null })).status, 401);
  });

  test('viewer may read the calendar and tasks but not the mailbox', async () => {
    assert.equal((await call('/api/secretary/mail', { role: 'viewer' })).status, 403);
    assert.equal((await call('/api/secretary/mail/mail_001', { role: 'viewer' })).status, 403);
    assert.equal(
      (await call('/api/secretary/mail/mail_001/reply', { role: 'viewer', method: 'POST', body: JSON.stringify({ body: 'x', confirm: true }) })).status,
      403,
    );
    assert.equal((await call('/api/secretary/calendar', { role: 'viewer' })).status, 200);
    assert.equal((await call('/api/secretary/tasks', { role: 'viewer' })).status, 200);
  });

  test('/api/auth/me publishes the permission list', async () => {
    const { status, body } = await call('/api/auth/me');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.user.permissions));
    for (const permission of ['mail:read', 'mail:write', 'calendar:read', 'tasks:write', 'dashboards:write']) {
      assert.ok(body.user.permissions.includes(permission), `manager holds ${permission}`);
    }
    const viewer = await call('/api/auth/me', { role: 'viewer' });
    assert.ok(!viewer.body.user.permissions.includes('mail:read'));
    assert.ok(viewer.body.user.permissions.includes('calendar:read'));
  });

  test('lists the mock inbox with counts and filters', async () => {
    const { status, body } = await call('/api/secretary/mail?limit=100');
    assert.equal(status, 200);
    assert.equal(body.mode, 'mock');
    assert.equal(body.total, 24);
    assert.equal(body.unread, 8);
    assert.equal(body.needsReply, 6);
    assert.equal(body.flagged, 3);
    const mail = body.items[0];
    for (const key of ['id', 'from', 'to', 'subject', 'receivedAt', 'preview', 'body', 'read', 'flagged', 'needsReply', 'replied', 'category', 'attachments']) {
      assert.ok(key in mail, `mail carries ${key}`);
    }
    assert.ok(body.items.some((item) => item.attachments.length > 0), 'some messages have attachments');

    const unread = await call('/api/secretary/mail?filter=unread');
    assert.equal(unread.body.total, 8);
    assert.ok(unread.body.items.every((item) => item.read === false));

    const search = await call('/api/secretary/mail?q=nordkabel');
    assert.ok(search.body.total >= 1);
    assert.match(search.body.items[0].from.email, /nordkabel/);

    const limited = await call('/api/secretary/mail?limit=3');
    assert.equal(limited.body.items.length, 3);
    assert.equal(limited.body.total, 24, 'total counts all matches, not the page');
  });

  test('reads one message, marks it read, flags it', async () => {
    const one = await call('/api/secretary/mail/mail_001');
    assert.equal(one.status, 200);
    assert.equal(one.body.item.id, 'mail_001');
    assert.ok(one.body.item.body.length > 50);
    assert.equal(one.body.item.read, false, 'GET marks nothing');

    const patched = await call('/api/secretary/mail/mail_001', { method: 'PATCH', body: JSON.stringify({ read: true, flagged: false }) });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.item.read, true);
    assert.equal(patched.body.item.flagged, false);

    assert.equal((await call('/api/secretary/mail/nope')).status, 404);
    const bad = await call('/api/secretary/mail/mail_001', { method: 'PATCH', body: JSON.stringify({ read: 'yes' }) });
    assert.equal(bad.status, 400);
  });

  test('drafts a reply without sending, in English or German', async () => {
    const en = await call('/api/secretary/mail/mail_001/draft', { method: 'POST', body: JSON.stringify({}) });
    assert.equal(en.status, 200);
    assert.match(en.body.draft.subject, /^Re: Delivery delay/);
    assert.ok(['formal', 'friendly'].includes(en.body.draft.tone));
    assert.match(en.body.draft.body, /Dear Stefan Brandl/);
    assert.match(en.body.draft.body, /Delivery delay WH-4410/);

    const de = await call('/api/secretary/mail/mail_003/draft', {
      method: 'POST',
      body: JSON.stringify({ language: 'de', instructions: 'Bitte das Ergebnis bis Freitag senden.' }),
    });
    assert.equal(de.status, 200);
    assert.match(de.body.draft.body, /Hallo Jonas/);
    assert.match(de.body.draft.body, /Bitte das Ergebnis bis Freitag senden\./);

    const after = await call('/api/secretary/mail/mail_001');
    assert.equal(after.body.item.replied, false, 'a draft never sends');
  });

  test('sending a reply requires an explicit confirmation and is audited', async () => {
    const refused = await call('/api/secretary/mail/mail_006/reply', {
      method: 'POST',
      body: JSON.stringify({ body: 'Please collect lot 2241.' }),
    });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error, 'confirmation_required');

    const sent = await call('/api/secretary/mail/mail_006/reply', {
      method: 'POST',
      body: JSON.stringify({ body: 'Please collect lot 2241.', confirm: true }),
    });
    assert.equal(sent.status, 200);
    assert.equal(sent.body.ok, true);
    assert.equal(sent.body.mode, 'simulated');

    const after = await call('/api/secretary/mail/mail_006');
    assert.equal(after.body.item.replied, true);

    const audit = await call('/api/audit?limit=200');
    const events = audit.body.events.filter((event) => event.action === 'mail.reply' && event.resource === 'mail_006');
    assert.ok(events.some((event) => event.outcome === 'simulated'), 'the simulated send is audited');
    assert.ok(events.some((event) => event.outcome === 'refused'), 'the refused send is audited too');
    assert.ok(audit.body.events.some((event) => event.action === 'mail.read'), 'mailbox reads are audited');
  });

  test('calendar for today, tomorrow and a named day', async () => {
    const today = await call('/api/secretary/calendar');
    assert.equal(today.status, 200);
    assert.equal(today.body.day, toIsoDate(now()));
    assert.ok(today.body.items.length >= 1);
    for (const key of ['id', 'title', 'startsAt', 'endsAt', 'location', 'attendees', 'organizer', 'isOnline']) {
      assert.ok(key in today.body.items[0], `event carries ${key}`);
    }
    const tomorrow = await call('/api/secretary/calendar?day=tomorrow');
    assert.equal(tomorrow.body.day, toIsoDate(addDays(now(), 1)));
    assert.ok(tomorrow.body.items.length >= 1);
    const named = await call(`/api/secretary/calendar?day=${toIsoDate(addDays(now(), 3))}`);
    assert.ok(named.body.items.length >= 1);
  });

  test('tasks: list, create, update, delete', async () => {
    const open = await call('/api/secretary/tasks');
    assert.equal(open.status, 200);
    assert.ok(open.body.items.length >= 3, 'seeded open tasks');
    assert.ok(open.body.items.every((task) => task.status === 'open'));

    const created = await call('/api/secretary/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Call HydroBrake about the 8D', dueAt: `${toIsoDate(now())}T15:00:00Z`, relatedMailId: 'mail_003' }),
    });
    assert.equal(created.status, 201);
    const task = created.body.item;
    assert.equal(task.status, 'open');
    assert.equal(task.source, 'mail');
    assert.equal(task.relatedMailId, 'mail_003');
    assert.ok(task.createdAt && task.createdBy);

    const done = await call(`/api/secretary/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) });
    assert.equal(done.body.item.status, 'done');
    const all = await call('/api/secretary/tasks?status=all');
    assert.ok(all.body.items.some((item) => item.id === task.id));

    assert.equal((await call(`/api/secretary/tasks/${task.id}`, { method: 'DELETE' })).body.ok, true);
    assert.equal((await call(`/api/secretary/tasks/${task.id}`, { method: 'DELETE' })).status, 404);

    const invalid = await call('/api/secretary/tasks', { method: 'POST', body: JSON.stringify({ title: '' }) });
    assert.equal(invalid.status, 400);
  });

  test('briefing has the agreed shape and a short spoken form', async () => {
    const { status, body } = await call('/api/secretary/briefing');
    assert.equal(status, 200);
    assert.equal(body.date, toIsoDate(now()));
    assert.ok(body.generatedAt && body.greeting);
    const ids = body.sections.map((section) => section.id);
    assert.deepEqual(ids, ['calendar', 'mail', 'tasks', 'production', 'maintenance']);
    for (const section of body.sections) {
      assert.ok(section.title && typeof section.headline === 'string');
      for (const item of section.items) {
        assert.ok(item.label && typeof item.detail === 'string');
      }
    }
    const sentences = body.spoken.split(/[.!?](?:\s|$)/).filter((part) => part.trim());
    assert.ok(sentences.length >= 2 && sentences.length <= 6, `spoken form is short, got ${sentences.length}`);

    const viewer = await call('/api/secretary/briefing', { role: 'viewer' });
    assert.deepEqual(viewer.body.sections.map((section) => section.id), ['calendar', 'tasks', 'production']);

    const german = await call('/api/secretary/briefing?language=de');
    assert.match(german.body.greeting, /^Guten/);
    assert.equal(german.body.sections[0].title, 'Kalender');
  });

  test('reminder phrases resolve to a title and a due time', () => {
    const base = now();
    const tomorrow9 = parseReminder('remind me to call the supplier tomorrow at 9');
    assert.equal(tomorrow9.title, 'Call the supplier');
    assert.equal(tomorrow9.dueAt, `${toIsoDate(addDays(base, 1))}T09:00:00.000Z`);

    const friday = parseReminder('remind me on Friday to send the shift plan');
    assert.equal(friday.title, 'Send the shift plan');
    assert.equal(new Date(friday.dueAt).getUTCDay(), 5);
    assert.ok(friday.dueAt > base.toISOString(), 'a weekday is the next one, never in the past');

    const inTwoHours = parseReminder('remind me in 2 hours to check the paint line');
    assert.equal(inTwoHours.title, 'Check the paint line');
    assert.equal(Math.round((new Date(inTwoHours.dueAt) - base) / 60000), 120);

    const german = parseReminder('erinnere mich morgen um 9 daran, den Lieferanten anzurufen');
    assert.equal(german.title, 'Den Lieferanten anzurufen');
    assert.equal(german.dueAt, `${toIsoDate(addDays(base, 1))}T09:00:00.000Z`);

    const undated = parseReminder('remind me to book the service visit');
    assert.equal(undated.title, 'Book the service visit');
    assert.equal(undated.dueAt, null);

    assert.equal(parseReminder('what problems did we have on Friday?'), null);
  });

  test('chat creates the reminder as a task', async () => {
    const chat = await call('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: 'remind me to call the supplier tomorrow at 9' }),
    });
    assert.equal(chat.status, 200);
    assert.equal(chat.body.interpretation.intent, 'create_reminder');
    assert.ok(chat.body.tasks?.created?.id, 'the created task is attached to the answer');
    assert.match(chat.body.answer.headline, /Reminder set: Call the supplier/);

    const tasks = await call('/api/secretary/tasks');
    assert.ok(tasks.body.items.some((task) => task.id === chat.body.tasks.created.id && task.source === 'jervis'));
  });

  test('chat answers inbox, calendar and briefing with structured payloads', async () => {
    const inbox = await call('/api/chat', { method: 'POST', body: JSON.stringify({ message: 'which emails need a reply?' }) });
    assert.equal(inbox.body.interpretation.intent, 'inbox_summary');
    assert.ok(Array.isArray(inbox.body.mail.items));
    assert.equal(inbox.body.mail.mode, 'mock');

    const calendar = await call('/api/chat', { method: 'POST', body: JSON.stringify({ message: "what's on my calendar tomorrow?" }) });
    assert.equal(calendar.body.interpretation.intent, 'calendar_today');
    assert.equal(calendar.body.events.day, toIsoDate(addDays(now(), 1)));

    const briefing = await call('/api/chat', { method: 'POST', body: JSON.stringify({ message: 'give me my morning briefing' }) });
    assert.equal(briefing.body.interpretation.intent, 'daily_briefing');
    assert.equal(briefing.body.briefing.sections.length, 5);
    assert.equal(briefing.body.answer.spoken, briefing.body.briefing.spoken);
  });

  test('the agent withholds mail tools from a viewer and says so', async () => {
    const { body } = await call('/api/chat', { role: 'viewer', method: 'POST', body: JSON.stringify({ message: "what's in my inbox?" }) });
    assert.equal(body.sources.length, 0, 'nothing was read');
    assert.ok(body.withheld.some((entry) => entry.tool === 'mail.search' && entry.permission === 'mail:read'));
    assert.ok(body.answer.redactions.some((entry) => entry.element === 'tool:mail.search'));
    assert.ok(body.trace.some((step) => step.name === 'withheld'));
    assert.match(body.answer.headline, /Not available for your role/);

    const audit = await call('/api/audit?limit=100');
    assert.ok(audit.body.events.some((event) => event.action === 'tool.withheld' && event.resource === 'mail.search'));
  });
});

describe('Voice speech-to-text fallback', () => {
  let sttServer;
  let sttUrl;

  before(async () => {
    sttServer = createApp().listen(0);
    await new Promise((resolve) => sttServer.once('listening', resolve));
    sttUrl = `http://127.0.0.1:${sttServer.address().port}`;
  });

  after(() => sttServer?.close());

  test('answers 501 without an ElevenLabs key', async () => {
    const response = await fetch(`${sttUrl}/api/voice/stt?language=de`, {
      method: 'POST',
      headers: { 'x-jervis-role': 'manager', 'content-type': 'audio/webm' },
      body: Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
    });
    assert.equal(response.status, 501);
    const body = await response.json();
    assert.equal(body.error, 'stt_unavailable');
    assert.equal(body.message, 'Speech-to-text needs an ElevenLabs key on the server.');
  });

  test('config reports the engine for both tts and stt', async () => {
    const response = await fetch(`${sttUrl}/api/voice/config`, { headers: { 'x-jervis-role': 'manager' } });
    const body = await response.json();
    assert.equal(body.stt.enabled, false);
    assert.equal(body.stt.provider, 'browser');
  });
});
