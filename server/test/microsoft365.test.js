import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Isolate the settings store before any module reads it.
process.env.JERVIS_INTEGRATIONS_FILE = join(tmpdir(), `jervis-ms365-${randomUUID()}.json`);
delete process.env.MS365_TENANT_ID;
delete process.env.MS365_CLIENT_ID;
delete process.env.MS365_CLIENT_SECRET;
delete process.env.MS365_MAILBOX;

const { createLiveMailProvider, fromGraphMessage, stripHtml, dayWindow, classifyMail } = await import(
  '../src/connectors/microsoft365.connector.js'
);
const { mailProvider, mailMode } = await import('../src/secretary/provider.js');
const { resetStore, saveSettings } = await import('../src/integrations/store.js');

const SETTINGS = {
  tenantId: 'tenant-1',
  clientId: 'client-1',
  clientSecret: 'super-secret',
  mailbox: 'mara.keller@plant.example',
  timezone: 'W. Europe Standard Time',
};

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  json: async () => body,
});

const GRAPH_MESSAGE = {
  id: 'AAMk1',
  from: { emailAddress: { name: 'Stefan Brandl', address: 's.brandl@nordkabel.example' } },
  toRecipients: [{ emailAddress: { address: 'Mara.Keller@plant.example' } }],
  subject: 'Delivery delay WH-4410 wiring harness',
  receivedDateTime: '2026-10-13T07:42:00Z',
  bodyPreview: 'Dear Ms Keller, the batch will arrive one day late.',
  body: { contentType: 'html', content: '<html><body><p>Dear Ms Keller,</p><p>the batch <b>WH-4410</b> will arrive &amp; one day late.</p></body></html>' },
  isRead: false,
  isDraft: false,
  flag: { flagStatus: 'flagged' },
  hasAttachments: true,
};

/**
 * A fake fetch that records every call and answers by URL pattern. Each
 * handler gets (url, options) and returns a response-like object.
 */
const fakeFetch = (routes) => {
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    for (const [pattern, handler] of routes) {
      if (pattern.test(String(url))) return handler(String(url), options);
    }
    return json({ error: { message: `unexpected ${url}` } }, 500);
  };
  return { fetch, calls };
};

const tokenRoute = [/login\.microsoftonline\.com/, () => json({ access_token: 'TOKEN-123', expires_in: 3600 })];

describe('Microsoft 365 live connector', () => {
  test('requests a client-credentials token once and caches it', async () => {
    const { fetch, calls } = fakeFetch([
      tokenRoute,
      [/mailFolders\/inbox\?/, () => json({ totalItemCount: 10, unreadItemCount: 2 })],
      [/\$count=true/, () => json({ '@odata.count': 1, value: [] })],
      [/isRead%20eq%20false/, () => json({ value: [] })],
      [/messages\?/, () => json({ value: [] })],
    ]);
    const provider = createLiveMailProvider({ fetch, settings: () => SETTINGS });
    await provider.listMail({});
    await provider.listMail({});

    const tokenCalls = calls.filter((call) => call.url.includes('login.microsoftonline.com'));
    assert.equal(tokenCalls.length, 1, 'the token is cached between calls');
    assert.equal(tokenCalls[0].url, 'https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token');
    assert.equal(tokenCalls[0].options.method, 'POST');
    const form = tokenCalls[0].options.body;
    assert.equal(form.get('grant_type'), 'client_credentials');
    assert.equal(form.get('client_id'), 'client-1');
    assert.equal(form.get('client_secret'), 'super-secret');
    assert.equal(form.get('scope'), 'https://graph.microsoft.com/.default');

    const graphCall = calls.find((call) => call.url.includes('graph.microsoft.com'));
    assert.equal(graphCall.options.headers.authorization, 'Bearer TOKEN-123');
    assert.match(graphCall.options.headers.prefer, /outlook\.timezone="W\. Europe Standard Time"/);
  });

  test('lists the inbox with the Graph query and maps messages to the Mail shape', async () => {
    const { fetch, calls } = fakeFetch([
      tokenRoute,
      [/mailFolders\/inbox\?/, () => json({ totalItemCount: 24, unreadItemCount: 8 })],
      [/\$count=true/, () => json({ '@odata.count': 3, value: [] })],
      [/\$top=100/, () => json({ value: [GRAPH_MESSAGE, { ...GRAPH_MESSAGE, id: 'AAMk2', from: { emailAddress: { address: 'noreply@integral.internal' } } }] })],
      [/attachments/, () => json({ value: [{ name: 'ETA.pdf', size: 184322 }] })],
      [/messages\?/, () => json({ value: [GRAPH_MESSAGE] })],
    ]);
    const provider = createLiveMailProvider({ fetch, settings: () => SETTINGS });
    const result = await provider.listMail({ filter: 'unread', limit: 5 });

    const listing = calls.find((call) => /messages\?/.test(call.url) && call.url.includes('$orderby'));
    assert.ok(listing, 'the inbox listing was requested');
    assert.ok(listing.url.startsWith('https://graph.microsoft.com/v1.0/users/mara.keller%40plant.example/mailFolders/inbox/messages?'));
    assert.match(listing.url, /\$top=5/);
    assert.match(listing.url, /\$orderby=receivedDateTime desc/);
    assert.match(listing.url, /\$filter=isRead%20eq%20false/);
    assert.match(listing.url, /\$select=id,from,toRecipients/);

    assert.equal(result.items.length, 1);
    assert.equal(result.inboxTotal, 24);
    assert.equal(result.unread, 8);
    assert.equal(result.flagged, 3);
    assert.equal(result.needsReply, 1, 'the no-reply sender is excluded from needsReply');

    const mail = result.items[0];
    assert.equal(mail.id, 'AAMk1');
    assert.deepEqual(mail.from, { name: 'Stefan Brandl', email: 's.brandl@nordkabel.example' });
    assert.deepEqual(mail.to, ['mara.keller@plant.example']);
    assert.equal(mail.read, false);
    assert.equal(mail.flagged, true);
    assert.equal(mail.needsReply, true);
    assert.equal(mail.replied, false);
    assert.equal(mail.category, 'supplier');
    assert.equal(mail.body, 'Dear Ms Keller,\nthe batch WH-4410 will arrive & one day late.');
    assert.ok(!mail.body.includes('<'), 'html tags are stripped');
    assert.deepEqual(mail.attachments, [{ name: 'ETA.pdf', size: 184322 }]);
    for (const key of ['id', 'from', 'to', 'subject', 'receivedAt', 'preview', 'body', 'read', 'flagged', 'needsReply', 'replied', 'category', 'attachments']) {
      assert.ok(key in mail, `mail carries ${key}`);
    }
  });

  test('uses $search for a free-text query and $filter for flagged', async () => {
    const { fetch, calls } = fakeFetch([
      tokenRoute,
      [/mailFolders\/inbox\?/, () => json({ totalItemCount: 1, unreadItemCount: 0 })],
      [/\$count=true/, () => json({ '@odata.count': 0, value: [] })],
      [/isRead%20eq%20false/, () => json({ value: [] })],
      [/messages\?/, () => json({ value: [] })],
    ]);
    const provider = createLiveMailProvider({ fetch, settings: () => SETTINGS });
    await provider.listMail({ q: 'Nordkabel delivery', limit: 3 });
    const search = calls.find((call) => call.url.includes('$search'));
    assert.ok(search, 'a $search listing was requested');
    assert.match(search.url, /\$search=%22Nordkabel%20delivery%22/);
    assert.ok(!search.url.includes('$orderby'), '$orderby is not combined with $search');

    await provider.listMail({ filter: 'flagged' });
    const flagged = calls.find((call) => call.url.includes('$orderby') && call.url.includes('flagStatus'));
    assert.ok(flagged, 'the flagged filter is server-side');
    assert.match(flagged.url, /\$filter=flag%2FflagStatus%20eq%20'flagged'/);
  });

  test('needsReply heuristic: replied, cc-only, read and drafts do not need a reply', () => {
    const mailbox = 'mara.keller@plant.example';
    const base = { ...GRAPH_MESSAGE, flag: { flagStatus: 'notFlagged' } };
    assert.equal(fromGraphMessage(base, { mailbox }).needsReply, true);
    assert.equal(fromGraphMessage({ ...base, isRead: true }, { mailbox }).needsReply, false);
    assert.equal(fromGraphMessage({ ...base, isDraft: true }, { mailbox }).needsReply, false);
    assert.equal(
      fromGraphMessage({ ...base, toRecipients: [{ emailAddress: { address: 'someone.else@plant.example' } }] }, { mailbox }).needsReply,
      false,
      'cc-only messages are not addressed to the mailbox',
    );
    const replied = fromGraphMessage(
      { ...base, singleValueExtendedProperties: [{ id: 'Integer 0x1081', value: '102' }] },
      { mailbox },
    );
    assert.equal(replied.replied, true);
    assert.equal(replied.needsReply, false);
    assert.equal(fromGraphMessage({ ...base, body: { contentType: 'text', content: 'plain' } }, { mailbox }).body, 'plain');
  });

  test('classifies categories from subject and sender like the mock inbox', () => {
    assert.equal(classifyMail({ subject: 'Maintenance report: Torque station T7', from: { email: 'noreply@integral.internal' } }), 'maintenance');
    assert.equal(classifyMail({ subject: 'Quality escalation: E-7781 brake line leak', from: { email: 'jonas@plant.example' } }), 'quality');
    assert.equal(classifyMail({ subject: 'Invitation: Weekly quality review', from: { email: 'petra@plant.example' } }), 'meeting');
    assert.equal(classifyMail({ subject: 'Planned maintenance: Power BI gateway', from: { email: 'servicedesk@plant.example' } }), 'it');
    assert.equal(classifyMail({ subject: 'Shift schedule confirmation', from: { email: 'hr@plant.example' } }), 'hr');
    assert.equal(classifyMail({ subject: 'Lunch?', from: { email: 'thomas@plant.example' } }), 'other');
    assert.equal(stripHtml('<p>a</p><br>b &nbsp; <style>x{}</style>c'), 'a\n\nb c');
  });

  test('updateMail PATCHes isRead and flag.flagStatus', async () => {
    const { fetch, calls } = fakeFetch([
      tokenRoute,
      [/messages\/AAMk1$/, (_url, options) => json({ ...GRAPH_MESSAGE, hasAttachments: false, isRead: JSON.parse(options.body).isRead, flag: JSON.parse(options.body).flag })],
    ]);
    const provider = createLiveMailProvider({ fetch, settings: () => SETTINGS });
    const mail = await provider.updateMail('AAMk1', { read: true, flagged: false });
    const patch = calls.find((call) => call.options.method === 'PATCH');
    assert.ok(patch, 'a PATCH was sent');
    assert.equal(patch.url, 'https://graph.microsoft.com/v1.0/users/mara.keller%40plant.example/messages/AAMk1');
    assert.deepEqual(JSON.parse(patch.options.body), { isRead: true, flag: { flagStatus: 'notFlagged' } });
    assert.equal(patch.options.headers['content-type'], 'application/json');
    assert.equal(mail.read, true);
    assert.equal(mail.flagged, false);
  });

  test('getMail returns null for an unknown id and the body for a known one', async () => {
    const { fetch } = fakeFetch([
      tokenRoute,
      [/messages\/missing\?/, () => json({ error: { code: 'ErrorItemNotFound', message: 'The specified object was not found in the store.' } }, 404)],
      [/messages\/AAMk1\?/, () => json({ ...GRAPH_MESSAGE, hasAttachments: false })],
    ]);
    const provider = createLiveMailProvider({ fetch, settings: () => SETTINGS });
    assert.equal(await provider.getMail('missing'), null);
    const mail = await provider.getMail('AAMk1');
    assert.equal(mail.subject, 'Delivery delay WH-4410 wiring harness');
    assert.deepEqual(mail.attachments, []);
  });

  test('listEvents asks calendarView for the day in the mailbox time zone', async () => {
    const { fetch, calls } = fakeFetch([
      tokenRoute,
      [/calendarView/, () =>
        json({
          value: [
            {
              id: 'evt1',
              subject: 'Weekly quality review',
              start: { dateTime: '2026-07-15T14:00:00.0000000', timeZone: 'W. Europe Standard Time' },
              end: { dateTime: '2026-07-15T15:00:00.0000000', timeZone: 'W. Europe Standard Time' },
              location: { displayName: 'B2.14' },
              attendees: [{ emailAddress: { name: 'Petra Lindqvist', address: 'p@plant.example' } }],
              organizer: { emailAddress: { name: 'Petra Lindqvist' } },
              isOnlineMeeting: true,
            },
          ],
        }),
      ],
    ]);
    const provider = createLiveMailProvider({ fetch, settings: () => SETTINGS });
    const result = await provider.listEvents({ day: '2026-07-15' });

    const call = calls.find((entry) => entry.url.includes('calendarView'));
    assert.ok(call.url.startsWith('https://graph.microsoft.com/v1.0/users/mara.keller%40plant.example/calendarView?'));
    assert.match(call.url, /startDateTime=2026-07-15T00%3A00%3A00%2B02%3A00/, 'window starts at local midnight (CEST)');
    assert.match(call.url, /endDateTime=2026-07-15T23%3A59%3A59%2B02%3A00/);
    assert.match(call.options.headers.prefer, /outlook\.timezone="W\. Europe Standard Time"/);

    assert.equal(result.day, '2026-07-15');
    const event = result.items[0];
    assert.equal(event.title, 'Weekly quality review');
    assert.equal(event.startsAt, '2026-07-15T12:00:00.000Z', '14:00 CEST is 12:00 UTC');
    assert.equal(event.endsAt, '2026-07-15T13:00:00.000Z');
    assert.equal(event.location, 'B2.14');
    assert.deepEqual(event.attendees, ['Petra Lindqvist']);
    assert.equal(event.organizer, 'Petra Lindqvist');
    assert.equal(event.isOnline, true);

    // Winter day: CET is +01:00.
    assert.equal(dayWindow('2026-01-10', 'W. Europe Standard Time').start, '2026-01-10T00:00:00+01:00');
    assert.equal(dayWindow('2026-01-10', 'UTC').end, '2026-01-10T23:59:59+00:00');
  });

  test('sendReply POSTs the comment to /reply', async () => {
    const { fetch, calls } = fakeFetch([
      tokenRoute,
      [/messages\/AAMk1\/reply$/, () => ({ ok: true, status: 202, headers: { get: () => null }, json: async () => null })],
    ]);
    const provider = createLiveMailProvider({ fetch, settings: () => SETTINGS });
    const result = await provider.sendReply('AAMk1', { body: 'Thanks, a partial delivery tonight helps.' });
    const post = calls.find((call) => call.url.endsWith('/reply'));
    assert.equal(post.options.method, 'POST');
    assert.deepEqual(JSON.parse(post.options.body), { comment: 'Thanks, a partial delivery tonight helps.' });
    assert.deepEqual(result, { ok: true, mode: 'live', id: 'AAMk1' });
  });

  test('a Graph failure surfaces as a 502-style error, never as mock data', async () => {
    const { fetch } = fakeFetch([
      tokenRoute,
      [/graph\.microsoft\.com/, () => json({ error: { code: 'InternalServerError', message: 'boom' } }, 500)],
    ]);
    const provider = createLiveMailProvider({ fetch, settings: () => SETTINGS });
    await assert.rejects(provider.listMail({}), (error) => {
      assert.equal(error.status, 502);
      assert.equal(error.statusCode, 502);
      assert.match(error.message, /boom/);
      return true;
    });
    await assert.rejects(provider.sendReply('missing', { body: 'x' }), (error) => error.status === 502);

    const denied = fakeFetch([[/login\.microsoftonline\.com/, () => json({ error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret\nTrace' }, 401)]]);
    const broken = createLiveMailProvider({ fetch: denied.fetch, settings: () => SETTINGS });
    await assert.rejects(broken.listMail({}), (error) => error.status === 502 && /AADSTS7000215/.test(error.message) && !/super-secret/.test(error.message));
  });

  test('a missing message on reply is a 404 error', async () => {
    const { fetch } = fakeFetch([
      tokenRoute,
      [/\/reply$/, () => json({ error: { code: 'ErrorItemNotFound', message: 'not found' } }, 404)],
    ]);
    const provider = createLiveMailProvider({ fetch, settings: () => SETTINGS });
    await assert.rejects(provider.sendReply('gone', { body: 'x' }), (error) => error.status === 404);
  });
});

describe('secretary provider switch', () => {
  beforeEach(() => resetStore());

  test('returns the mock provider until Microsoft 365 is configured and enabled', () => {
    assert.equal(mailMode(), 'mock');
    saveSettings('microsoft365', { values: { tenantId: 't', clientId: 'c', clientSecret: 's', mailbox: 'm@plant.example' } }, 'test');
    assert.equal(mailMode(), 'mock', 'configured but not enabled stays mock');
    saveSettings('microsoft365', { enabled: true }, 'test');
    assert.equal(mailMode(), 'live');
    assert.equal(mailProvider().mode, 'live');
    assert.equal(typeof mailProvider().listMail, 'function');
    saveSettings('microsoft365', { enabled: false }, 'test');
    assert.equal(mailMode(), 'mock');
  });
});
