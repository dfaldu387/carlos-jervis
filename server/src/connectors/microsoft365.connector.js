import { resolve_ } from '../integrations/store.js';
import { resolveDay } from '../secretary/mailbox.js';
import { logger } from '../utils/logger.js';

/**
 * Microsoft 365 connector (mail and calendar via Microsoft Graph).
 *
 * Implements the same interface as the mock mailbox in secretary/mailbox.js:
 * listMail, getMail, updateMail, listEvents, sendReply. secretary/provider.js
 * returns this object only when the connector is configured AND enabled on
 * the Integrations page; until then the synthetic mailbox answers.
 *
 *   token      POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
 *   listMail   GET  /users/{mailbox}/mailFolders/inbox/messages?$top&$orderby&$select&$filter|$search
 *   getMail    GET  /users/{mailbox}/messages/{id}
 *   updateMail PATCH /users/{mailbox}/messages/{id}   { isRead, flag }
 *   listEvents GET  /users/{mailbox}/calendarView?startDateTime&endDateTime
 *   sendReply  POST /users/{mailbox}/messages/{id}/reply   { comment }
 *
 * Failures are surfaced, never papered over: a Graph error becomes a thrown
 * error with `status` (502 for an upstream failure, 404 for a missing message)
 * and the routes turn it into a JSON error. The provider does not fall back
 * to the mock data when live mode is on.
 *
 * The client secret and the access token never reach a log line.
 */

const GRAPH = 'https://graph.microsoft.com/v1.0';
const LOGIN = 'https://login.microsoftonline.com';
const DEFAULT_TIMEZONE = 'W. Europe Standard Time';
const TIMEOUT_MS = 10_000;
/** Refresh the cached token this long before Entra says it expires. */
const TOKEN_SKEW_MS = 60_000;

/** Fields a message listing needs; the body is included so getMail is one call. */
const MESSAGE_SELECT = [
  'id',
  'from',
  'toRecipients',
  'ccRecipients',
  'subject',
  'receivedDateTime',
  'bodyPreview',
  'body',
  'isRead',
  'isDraft',
  'flag',
  'hasAttachments',
  'conversationId',
].join(',');

/**
 * PidTagLastVerbExecuted (0x1081): Outlook stores the last action taken on a
 * message here. 102 = reply, 103 = reply all, 104 = forward. Reading it is the
 * only way Graph exposes "has this been answered" without walking the
 * conversation, so it is expanded on every message read.
 */
const LAST_VERB_EXPAND = "singleValueExtendedProperties($filter=id eq 'Integer 0x1081')";
const REPLY_VERBS = new Set(['102', '103']);

/** Windows time zone names Exchange uses -> IANA names Intl understands. */
const WINDOWS_TO_IANA = {
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'Romance Standard Time': 'Europe/Paris',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Kiev',
  'GTB Standard Time': 'Europe/Bucharest',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'India Standard Time': 'Asia/Kolkata',
  'China Standard Time': 'Asia/Shanghai',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  UTC: 'UTC',
};

/** Accept either a Windows name or an IANA name in the `timezone` field. */
const ianaZone = (timezone) => {
  const value = String(timezone || DEFAULT_TIMEZONE).trim();
  return WINDOWS_TO_IANA[value] ?? value;
};

/* ------------------------------------------------------------------------ */
/* Errors                                                                    */
/* ------------------------------------------------------------------------ */

/** Error the routes can render: `status`/`statusCode` for the HTTP layer, `code` for clients. */
export const graphError = (status, message, code = 'ms365_upstream') =>
  Object.assign(new Error(message), { status, statusCode: status, code });

const upstreamError = (operation, response, body) => {
  const detail = body?.error?.message ?? body?.error_description?.split('\n')[0] ?? `HTTP ${response.status}`;
  if (response.status === 404) {
    return graphError(404, `Microsoft Graph has no such item for ${operation}.`, 'ms365_not_found');
  }
  if (response.status === 401 || response.status === 403) {
    return graphError(502, `Microsoft Graph refused the ${operation} call (${response.status}): ${detail}`, 'ms365_denied');
  }
  return graphError(502, `Microsoft Graph ${operation} failed (${response.status}): ${detail}`);
};

/* ------------------------------------------------------------------------ */
/* Mapping                                                                   */
/* ------------------------------------------------------------------------ */

/** HTML body -> plain text good enough for a preview or a draft prompt. */
export const stripHtml = (html) =>
  String(html ?? '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

/** Senders that never expect an answer. */
const AUTOMATED_SENDER = /(^|[._-])(no-?reply|do-?not-?reply|notifications?|mailer-daemon|postmaster)([._-]|@)/i;

/**
 * Category heuristic mirroring the mock inbox's categories. The first rule
 * that matches the sender or the subject wins; everything else is 'other'.
 */
const CATEGORY_RULES = [
  { category: 'it', test: (from, subject) => /servicedesk|helpdesk|it-?support|it-?service/.test(from) || /\b(password|passwort|vpn|teams|outlook|gateway|laptop|login)\b/.test(subject) },
  { category: 'hr', test: (from, subject) => /(^|[.@_-])(hr|personal|people)[.@_-]/.test(from) || /\b(shift (plan|schedule)|training|schichtplan|schulung|vacation|urlaub|onboarding|new colleague)\b/.test(subject) },
  { category: 'maintenance', test: (from, subject) => /integral|maintenance|instandhaltung/.test(from) || /\b(maintenance|wartung|ticket|repair|reparatur|calibration|kalibrierung|preventive|instandhaltung)\b/.test(subject) },
  { category: 'meeting', test: (_from, subject) => /\b(invitation|einladung|meeting|besprechung|termin|1:1|agenda|accepted|declined|tentative)\b/.test(subject) },
  { category: 'quality', test: (_from, subject) => /\b(quality|qualit[äa]t|escalation|eskalation|defect|fehler|rework|nacharbeit|yield|8d|containment|audit|review)\b|\bE-\d{3,5}\b/.test(subject) },
  { category: 'supplier', test: (from, subject) => /\b(delivery|lieferung|supplier|lieferant|order|bestellung|eta|shipment|batch|charge|call-?off|abruf|firmware|invoice|rechnung)\b/.test(subject) || /orders?@|sales@|supply/.test(from) },
];

export const classifyMail = ({ subject = '', from = {} } = {}) => {
  const sender = `${from.name ?? ''} ${from.email ?? ''}`.toLowerCase();
  const text = String(subject).toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.test(sender, text)) return rule.category;
  }
  return 'other';
};

const address = (recipient) => String(recipient?.emailAddress?.address ?? '').toLowerCase();

/**
 * Maps a Graph message onto the Mail shape the API publishes, so the UI never
 * sees a Graph-specific field.
 *
 * needsReply heuristic (documented in docs/SECRETARY-API.md): the message is
 * unread, has not been replied to (PidTagLastVerbExecuted), is addressed to
 * the mailbox directly (To, not only Cc) and does not come from an automated
 * sender (no-reply, notifications, ...). Read messages are the user's call.
 */
export const fromGraphMessage = (message, { mailbox = '', attachments = null } = {}) => {
  const from = {
    name: message.from?.emailAddress?.name ?? message.sender?.emailAddress?.name ?? '',
    email: message.from?.emailAddress?.address ?? message.sender?.emailAddress?.address ?? '',
  };
  const to = (message.toRecipients ?? []).map(address).filter(Boolean);
  const read = Boolean(message.isRead);
  const flagged = message.flag?.flagStatus === 'flagged';
  const lastVerb = (message.singleValueExtendedProperties ?? []).find((property) => /0x1081/i.test(property.id ?? ''));
  const replied = REPLY_VERBS.has(String(lastVerb?.value ?? ''));
  const addressed = !mailbox || to.includes(String(mailbox).toLowerCase());
  const automated = AUTOMATED_SENDER.test(from.email);
  const html = String(message.body?.contentType ?? '').toLowerCase() === 'html';
  const body = html ? stripHtml(message.body?.content) : String(message.body?.content ?? '');
  const preview = String(message.bodyPreview ?? '').replace(/\s+/g, ' ').trim().slice(0, 140) || body.replace(/\s+/g, ' ').slice(0, 140);

  return {
    id: message.id,
    from,
    to,
    subject: message.subject ?? '',
    receivedAt: message.receivedDateTime ?? null,
    preview,
    body,
    read,
    flagged,
    needsReply: !read && !replied && addressed && !automated && !message.isDraft,
    replied,
    category: classifyMail({ subject: message.subject, from }),
    attachments: (attachments ?? message.attachments ?? []).map((attachment) => ({
      name: attachment.name ?? '',
      size: attachment.size ?? 0,
    })),
  };
};

/** Graph `{ dateTime, timeZone }` -> ISO instant, using the zone the header asked for. */
const toInstant = (value, zone) => {
  if (!value?.dateTime) return null;
  const wall = String(value.dateTime).replace(/(\.\d{3})\d*$/, '$1');
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(wall)) return new Date(wall).toISOString();
  const naive = new Date(`${wall}Z`);
  const offset = offsetMinutes(naive, ianaZone(value.timeZone || zone));
  return new Date(naive.getTime() - offset * 60_000).toISOString();
};

const fromGraphEvent = (event, zone) => ({
  id: event.id,
  title: event.subject ?? '',
  startsAt: toInstant(event.start, zone),
  endsAt: toInstant(event.end, zone),
  location: event.location?.displayName ?? '',
  attendees: (event.attendees ?? [])
    .map((attendee) => attendee.emailAddress?.name || attendee.emailAddress?.address)
    .filter(Boolean),
  organizer: event.organizer?.emailAddress?.name ?? event.organizer?.emailAddress?.address ?? '',
  isOnline: Boolean(event.isOnlineMeeting),
  isAllDay: Boolean(event.isAllDay),
});

/* ------------------------------------------------------------------------ */
/* Time zones                                                                */
/* ------------------------------------------------------------------------ */

/** Minutes east of UTC that `zone` observes at the given instant; 0 if the zone is unknown. */
export const offsetMinutes = (date, zone) => {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(date);
    const get = (type) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
    return Math.round((wall - date.getTime()) / 60_000);
  } catch {
    return 0;
  }
};

const formatOffset = (minutes) => {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
};

/**
 * The calendarView window for one civil day in the mailbox time zone, as the
 * offset-qualified timestamps Graph accepts. The offset is sampled at noon of
 * that day, so a DST switch at 02:00 is off by an hour at most on one edge.
 */
export const dayWindow = (isoDate, timezone) => {
  const zone = ianaZone(timezone);
  const offset = formatOffset(offsetMinutes(new Date(`${isoDate}T12:00:00Z`), zone));
  return { start: `${isoDate}T00:00:00${offset}`, end: `${isoDate}T23:59:59${offset}`, zone };
};

/* ------------------------------------------------------------------------ */
/* Client                                                                    */
/* ------------------------------------------------------------------------ */

const encodeOData = (value) => String(value).replace(/'/g, "''");

/** Graph $search value: double quotes delimit it, so they are dropped from the text. */
const searchClause = (q) => `"${String(q).replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim()}"`;

const withTimeout = async (fetchImpl, url, options = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw graphError(502, `Microsoft Graph did not answer within ${TIMEOUT_MS / 1000}s.`, 'ms365_timeout');
    }
    throw graphError(502, `Microsoft Graph is not reachable: ${error?.cause?.code ?? error?.message ?? 'network error'}`, 'ms365_unreachable');
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Builds a live provider. `fetch` and `settings` are injectable so the tests
 * can drive it without the network or the settings store; the default export
 * below reads both from the environment.
 *
 * @param {{ fetch?: Function, settings?: Function }} options
 */
export const createLiveMailProvider = ({ fetch: fetchOption = null, settings: settingsOption = null } = {}) => {
  const fetchImpl = (...args) => (fetchOption ?? globalThis.fetch)(...args);
  const settings = () => (settingsOption ? settingsOption() : resolve_('microsoft365')) ?? {};

  /** { value, expiresAt, key } - key ties the token to the credentials it was issued for. */
  let token = null;
  /** Concurrent calls share one token request instead of each asking Entra. */
  let pending = null;

  const credentialKey = (values) => `${values.tenantId}|${values.clientId}|${values.clientSecret?.length ?? 0}`;

  const accessToken = async () => {
    const values = settings();
    if (!values.tenantId || !values.clientId || !values.clientSecret) {
      throw graphError(502, 'Microsoft 365 is not configured (tenant, client id and secret are required).', 'ms365_not_configured');
    }
    const key = credentialKey(values);
    if (token && token.key === key && token.expiresAt - TOKEN_SKEW_MS > Date.now()) return token.value;
    if (pending) return pending;
    pending = requestToken(values, key).finally(() => {
      pending = null;
    });
    return pending;
  };

  const requestToken = async (values, key) => {
    const response = await withTimeout(fetchImpl, `${LOGIN}/${encodeURIComponent(values.tenantId)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: values.clientId,
        client_secret: values.clientSecret,
        scope: 'https://graph.microsoft.com/.default',
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.access_token) {
      const reason = body.error_description?.split('\n')[0] ?? body.error ?? `HTTP ${response.status}`;
      logger.warn('Microsoft 365 token request failed', { status: response.status, reason });
      throw graphError(502, `Microsoft 365 sign-in failed: ${reason}`, 'ms365_token');
    }
    token = {
      value: body.access_token,
      expiresAt: Date.now() + Number(body.expires_in ?? 3600) * 1000,
      key,
    };
    return token.value;
  };

  const mailboxPath = () => `${GRAPH}/users/${encodeURIComponent(settings().mailbox ?? '')}`;

  /** One authenticated Graph call. Returns the parsed JSON (or null for 202/204). */
  const graph = async (operation, path, { method = 'GET', body = undefined, headers = {} } = {}) => {
    const bearer = await accessToken();
    const url = path.startsWith('http') ? path : `${mailboxPath()}${path}`;
    const response = await withTimeout(fetchImpl, url, {
      method,
      headers: {
        authorization: `Bearer ${bearer}`,
        accept: 'application/json',
        prefer: `outlook.timezone="${settings().timezone || DEFAULT_TIMEZONE}", outlook.body-content-type="text"`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = response.status === 202 || response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      logger.warn('Microsoft Graph call failed', { operation, status: response.status });
      throw upstreamError(operation, response, json);
    }
    return json;
  };

  /** Attachment names and sizes for one message; only called when hasAttachments is set. */
  const attachmentsOf = async (id) => {
    const result = await graph('attachments', `/messages/${encodeURIComponent(id)}/attachments?$select=name,size`);
    return (result?.value ?? []).map((item) => ({ name: item.name ?? '', size: item.size ?? 0 }));
  };

  const mapMessage = async (message) => {
    const attachments = message.hasAttachments ? await attachmentsOf(message.id) : [];
    return fromGraphMessage(message, { mailbox: settings().mailbox, attachments });
  };

  /**
   * Inbox-wide counters for the response header line. The folder resource
   * carries total/unread; flagged is an OData count; needsReply is the
   * heuristic applied to the newest 100 unread messages (an approximation on
   * a very busy inbox, and documented as such).
   */
  const summary = async () => {
    const [folder, flagged, unread] = await Promise.all([
      graph('inbox', '/mailFolders/inbox?$select=totalItemCount,unreadItemCount'),
      graph('flaggedCount', "/mailFolders/inbox/messages?$count=true&$top=1&$select=id&$filter=flag/flagStatus eq 'flagged'"),
      graph(
        'unreadSample',
        `/mailFolders/inbox/messages?$top=100&$select=id,from,toRecipients,isRead,isDraft,flag&$filter=isRead eq false&$expand=${LAST_VERB_EXPAND}`,
      ),
    ]);
    const mailbox = settings().mailbox;
    const needsReply = (unread?.value ?? []).filter((message) => fromGraphMessage(message, { mailbox }).needsReply).length;
    return {
      inboxTotal: folder?.totalItemCount ?? 0,
      unread: folder?.unreadItemCount ?? 0,
      flagged: flagged?.['@odata.count'] ?? 0,
      needsReply,
    };
  };

  const FILTER_CLAUSE = {
    all: null,
    unread: 'isRead eq false',
    needsReply: 'isRead eq false',
    flagged: "flag/flagStatus eq 'flagged'",
  };

  return {
    mode: 'live',

    /**
     * Graph does not combine $search with $filter or $orderby, so a free-text
     * query asks for relevance-ranked hits and the filter is applied here;
     * without a query the filter and the newest-first order are server-side.
     */
    async listMail({ filter = 'all', q = '', limit = 20 } = {}) {
      const top = Math.max(1, Math.min(100, Number(limit) || 20));
      const clause = FILTER_CLAUSE[filter] ?? null;
      const query = String(q ?? '').trim();
      const params = [`$select=${MESSAGE_SELECT}`, `$expand=${LAST_VERB_EXPAND}`];
      if (query) {
        params.push(`$search=${encodeURIComponent(searchClause(query))}`, `$top=${Math.min(100, top * 2)}`);
      } else {
        params.push('$orderby=receivedDateTime desc', `$top=${top}`);
        if (clause) params.push(`$filter=${encodeURIComponent(clause)}`);
      }
      const [page, counts] = await Promise.all([
        graph('listMail', `/mailFolders/inbox/messages?${params.join('&')}`),
        summary(),
      ]);
      const mailbox = settings().mailbox;
      let rows = (page?.value ?? []).map((message) => ({ message, mail: fromGraphMessage(message, { mailbox }) }));
      if (query && clause) rows = rows.filter(({ mail }) => (filter === 'flagged' ? mail.flagged : !mail.read));
      if (filter === 'needsReply') rows = rows.filter(({ mail }) => mail.needsReply);
      if (query) rows.sort((a, b) => (a.mail.receivedAt < b.mail.receivedAt ? 1 : -1));
      rows = rows.slice(0, top);
      const items = await Promise.all(rows.map(({ message }) => mapMessage(message)));
      return {
        items,
        total: items.length,
        inboxTotal: counts.inboxTotal,
        unread: counts.unread,
        needsReply: counts.needsReply,
        flagged: counts.flagged,
      };
    },

    /** null when Graph reports the id as unknown, so the routes answer 404 as in mock mode. */
    async getMail(id) {
      try {
        const message = await graph('getMail', `/messages/${encodeURIComponent(id)}?$select=${MESSAGE_SELECT}&$expand=${LAST_VERB_EXPAND}`);
        return message ? mapMessage(message) : null;
      } catch (error) {
        if (error.status === 404) return null;
        throw error;
      }
    },

    async updateMail(id, { read, flagged } = {}) {
      const patch = {};
      if (typeof read === 'boolean') patch.isRead = read;
      if (typeof flagged === 'boolean') patch.flag = { flagStatus: flagged ? 'flagged' : 'notFlagged' };
      try {
        const message = await graph('updateMail', `/messages/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
        return message ? mapMessage(message) : this.getMail(id);
      } catch (error) {
        if (error.status === 404) return null;
        throw error;
      }
    },

    /** One civil day in the mailbox time zone, expanded occurrences included. */
    async listEvents({ day = 'today' } = {}) {
      const iso = resolveDay(day);
      const zone = settings().timezone || DEFAULT_TIMEZONE;
      const window = dayWindow(iso, zone);
      const params = [
        `startDateTime=${encodeURIComponent(window.start)}`,
        `endDateTime=${encodeURIComponent(window.end)}`,
        '$orderby=start/dateTime',
        '$top=50',
        '$select=id,subject,start,end,location,attendees,organizer,isOnlineMeeting,isAllDay',
      ];
      const page = await graph('listEvents', `/calendarView?${params.join('&')}`);
      const items = (page?.value ?? [])
        .map((event) => fromGraphEvent(event, zone))
        .sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
      return { items, day: iso, timezone: zone };
    },

    /** Graph answers 202 with no body; a missing message surfaces as a 404 error here. */
    async sendReply(id, { body }) {
      await graph('sendReply', `/messages/${encodeURIComponent(id)}/reply`, {
        method: 'POST',
        body: { comment: String(body ?? '') },
      });
      return { ok: true, mode: 'live', id };
    },

    /** Test hook: forget the cached token. */
    resetToken() {
      token = null;
      pending = null;
    },
  };
};

/** Where each call goes, for the trace and the docs. */
export const graphEndpoints = () => {
  const mailbox = encodeURIComponent(resolve_('microsoft365')?.mailbox || '{mailbox}');
  return {
    listMail: `${GRAPH}/users/${mailbox}/mailFolders/inbox/messages`,
    getMail: `${GRAPH}/users/${mailbox}/messages/{id}`,
    updateMail: `${GRAPH}/users/${mailbox}/messages/{id}`,
    listEvents: `${GRAPH}/users/${mailbox}/calendarView`,
    sendReply: `${GRAPH}/users/${mailbox}/messages/{id}/reply`,
  };
};

/** The provider secretary/provider.js hands out in live mode (global fetch, store settings). */
export const liveMailProvider = createLiveMailProvider();
