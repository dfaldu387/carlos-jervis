# Secretary, dashboards and language API

Everything added for the "AI secretary" direction, documented as implemented
so the web client can rely on it. All routes live under `/api`, require a
signed-in session (or the `x-jervis-role` header in development), and return
JSON. Errors follow the existing shape `{ error, message }` with `401`
(not signed in), `403` (missing permission, the message names it), `404`,
`400` (`request_error`, or `confirmation_required` for an unconfirmed send).

Permissions per route are listed with each endpoint; the matrix is in
`docs/ACCESS-MODEL.md`. `GET /api/auth/me` returns `user.permissions` (array
of permission ids) so the client can hide what the server would refuse.

Dates are ISO 8601 in UTC. "Today" is the configured reference date
(`JERVIS_REFERENCE_DATE`, or the real clock when unset); the mock mailbox and
calendar are generated relative to it.

---

## Shapes

```ts
Mail = {
  id: string,
  from: { name: string, email: string },
  to: string[],
  subject: string,
  receivedAt: string,          // ISO
  preview: string,             // first ~140 chars of the body
  body: string,
  read: boolean,
  flagged: boolean,
  needsReply: boolean,
  replied: boolean,
  category: 'supplier' | 'maintenance' | 'quality' | 'hr' | 'meeting' | 'it' | 'other',
  attachments: Array<{ name: string, size: number }>,
}

Event = {
  id: string, title: string,
  startsAt: string, endsAt: string,   // ISO
  location: string, attendees: string[], organizer: string, isOnline: boolean,
}

Task = {
  id: string, title: string,
  dueAt: string | null,               // ISO
  status: 'open' | 'done',
  source: 'manual' | 'mail' | 'jervis',
  relatedMailId: string | null,
  createdAt: string, createdBy: string,
  updatedAt?: string, completedAt?: string | null,
}

Section = {
  id: 'calendar' | 'mail' | 'tasks' | 'production' | 'maintenance',
  title: string, headline: string,
  items: Array<{ label: string, detail: string, href?: string, severity?: 'critical' | 'warning' | 'info' }>,
}

Dashboard = {
  id: string, title: string, question: string, language: 'en' | 'de',
  createdAt: string, createdBy: string, refreshedAt: string,
  period: { from: string, to: string, label: string },
  filter: { from, to, lineId?, shiftId?, modelId?, errorCode?, severity?, ... },
  widgets: Widget[],
}

Widget = {
  id: string,
  type: 'kpi' | 'bar' | 'line' | 'pie',
  title: string,
  source: { label: string, object: string },   // e.g. { label: 'Databricks', object: 'prod_quality.issue_events' }
  query: object,                               // how the data is recomputed; opaque to the client
  data: KpiData | BarData | LineData,
}
KpiData  = { value: number, unit: string, delta?: number }   // delta vs. the same-length period before
BarData  = Array<{ name: string, value: number }>           // also used by 'pie'
LineData = Array<{ date: string, value: number }>
```

`href` values in briefing items are client routes, relative to the app:
`calendar?day=YYYY-MM-DD`, `mail/<id>`, `tasks/<id>`,
`issues?severity=critical&status=open`, `issues?from=..&to=..`, `analytics`.

---

## Mail (`/api/secretary/mail`)

The mailbox is the synthetic one until Microsoft 365 is configured **and**
enabled on the Integrations page (`mode` tells you which). In mock mode the
inbox holds 24 messages over the last five days (8 unread, 6 needing a reply,
3 flagged, several with attachments).

### `GET /api/secretary/mail?filter=&q=&limit=` - `mail:read`

| Query | Values | Default |
| --- | --- | --- |
| `filter` | `all` \| `unread` \| `needsReply` \| `flagged` | `all` |
| `q` | free text, matched against sender, subject, body and category (every word must match; sender/category/subject hits rank above body hits) | - |
| `limit` | 1-100 | 50 |

Response:

```json
{ "items": [Mail], "total": 24, "unread": 8, "needsReply": 6, "flagged": 3, "mode": "mock" }
```

`total` counts every match for the filter/query, not just the page; `unread`,
`needsReply` and `flagged` always describe the whole inbox.

### `GET /api/secretary/mail/:id` - `mail:read`

`{ item: Mail }` with the full body. Marks nothing.

### `PATCH /api/secretary/mail/:id` - `mail:write`

Body `{ read?: boolean, flagged?: boolean }` -> `{ item: Mail }`.

### `POST /api/secretary/mail/:id/draft` - `mail:read`

Body `{ instructions?: string, language?: 'en' | 'de' }` (instructions up to
600 chars, carried verbatim as a paragraph of the draft).

```json
{ "draft": { "subject": "Re: ...", "body": "...", "tone": "formal" | "friendly", "language": "en", "provider": "deterministic" | "claude" } }
```

Deterministic template (greeting, acknowledgement of the subject, the usual
next step for the category, sign-off); when `JERVIS_LLM_PROVIDER=claude` the
template is reworded by Claude with the same facts. **Never sends.** Tone is
`friendly` for internal colleagues (quality, meeting, maintenance, other),
`formal` otherwise.

### `POST /api/secretary/mail/:id/reply` - `mail:write`

Body `{ body: string, confirm: boolean }`.

- `confirm !== true` -> `400 { "error": "confirmation_required", "message": "..." }` (audited as `mail.reply` / `refused`).
- Missing `body` -> `400 request_error`.
- Otherwise `{ "ok": true, "mode": "simulated" | "live", "id": "mail_006" }`. Mock mode marks the message `replied: true` and `read: true`; nothing leaves the server. Audited as `mail.reply` with outcome `simulated` (or `sent` in live mode).

---

## Calendar

### `GET /api/secretary/calendar?day=` - `calendar:read`

`day` = `today` (default) | `tomorrow` | `yesterday` | `YYYY-MM-DD`.

```json
{ "items": [Event], "day": "2026-10-13" }
```

Mock calendar: today (shift handover, supplier call, plant walk), tomorrow
(1:1, quality review), +3 days (management meeting), +5 days (service visit).

---

## Tasks / reminders (`/api/secretary/tasks`) - all `tasks:write`

Persisted to `server/data/tasks.json` (local state; the web engineer gitignores
it; a missing file is normal and the four seeded tasks are used). Override the
path with `JERVIS_TASKS_FILE`.

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/tasks?status=open\|done\|all` (default `open`) | - | `{ items: Task[], status }` sorted open first, then by due time |
| POST | `/tasks` | `{ title, dueAt?, relatedMailId? }` | `201 { item: Task }` (`source` is `mail` when `relatedMailId` is given, else `manual`) |
| PATCH | `/tasks/:id` | `{ status?, title?, dueAt? }` | `{ item: Task }` |
| DELETE | `/tasks/:id` | - | `{ ok: true }` |

Validation: `title` 1-200 chars, `dueAt` ISO 8601 or null, `status`
`open`/`done` -> `400 request_error` otherwise.

---

## Briefing

### `GET /api/secretary/briefing?language=en|de` - `calendar:read`

```json
{
  "generatedAt": "...", "date": "2026-10-13", "language": "en",
  "greeting": "Good morning, sir!",
  "headline": "Your briefing for Tuesday 2026-10-13",
  "sections": [Section],
  "spoken": "Good morning, sir! Here is what matters today. You have 3 appointments today, ... 8 unread emails, 6 need a reply, ... 1 open critical issue today and 2 h 18 min of downtime."
}
```

Sections appear only when the role holds the permission for them: `calendar`
(`calendar:read`), `mail` (`mail:read`: unread / needs-reply counts and the
top three to answer), `tasks` (`tasks:write`: overdue then due today),
`production` (`production:read`: open critical issues today, issues today
with the busiest line, downtime today), `maintenance` (`maintenance:read`:
open tickets of the last 7 days). `spoken` is 2-4 sentences for TTS.

---

## Dashboards (`/api/dashboards`)

Persisted to `server/data/dashboards.json` (same missing-file tolerance,
override with `JERVIS_DASHBOARDS_FILE`). Note the existing `GET /api/dashboard`
(singular, the overview page) is unchanged.

| Method | Path | Permission | Body | Response |
| --- | --- | --- | --- | --- |
| GET | `/` | `production:read` | - | `{ items: [{ id, title, question, createdAt, createdBy, widgetCount }] }` newest first |
| POST | `/` | `dashboards:write` | `{ question?, title?, language? }` (one of question/title required) | `201 { item: Dashboard }` |
| GET | `/:id` | `production:read` | - | `{ item: Dashboard }` with every widget's `data` recomputed from the repository |
| DELETE | `/:id` | `dashboards:write` | - | `{ ok: true }` |

How a dashboard is built (`server/src/dashboards/builder.js`): the question
goes through the same NLU as chat, so line, shift, model, error code,
severity and period filter every widget. Without a period the dashboard
covers the last 7 days. Widgets (max 6, most relevant first): KPIs for
vehicles affected, vehicles reworked, downtime (plus rework time / removed
when rework is asked for); a pie by error code when codes are asked for,
bars by line (or by error code when one line is named), by shift / model /
part when mentioned; a trend line for any multi-day period.

---

## Chat additions (`POST /api/chat`)

Body gains optional `language: 'en' | 'de'`, which overrides detection. The
result always carries `language`, and - depending on the intent - a
structured payload next to the narrated `answer`:

| Intent | Trigger examples | Payload on the result |
| --- | --- | --- |
| `inbox_summary` | "what's in my inbox", "unread emails", "emails that need a reply", "Posteingang", "ungelesene E-Mails" | `mail: { items: Mail[] (no body), total, unread, needsReply, filter, query, mode, needsReplyItems }` |
| `mail_search` | "find the email from Nordkabel about delivery", "E-Mail von Nordkabel suchen" | `mail: { items, total, ... }` |
| `calendar_today` | "what's on my calendar today/tomorrow", "meine Termine heute" | `events: { items: Event[], day, mode }`, `tasks: { items: Task[], day }` |
| `daily_briefing` | "morning briefing", "what do I need to know today", "Tagesbriefing", "was steht heute an" | `briefing: <briefing JSON>` (and `answer.spoken` is its `spoken`) |
| `create_reminder` | "remind me to call the supplier tomorrow at 9", "erinnere mich morgen um 9 daran, ..." | `tasks: { items: [Task], created: Task }` - the task is really created |
| `draft_reply` | "draft a reply to the supplier email", "antworte auf die E-Mail von Jonas" | `mail: { items: [Mail] }`, `draft: { mailId, subject, body, tone, language, provider }` |
| `powerbi_measure` | "what is the OEE in Power BI", "show me the first pass yield measure", "Kennzahl ... aus Power BI" | `measure: { name, key, value, unit, report, url }` or `{ name: null, ..., query, available: string[] }` |
| `create_dashboard` | "create a dashboard for paint line issues this week", "erstelle ein Dashboard ..." | `dashboard: Dashboard` |

Reminder phrases understood: `tomorrow at 9`, `at 14:30`, `at 3 pm`,
`on Friday` / `next Monday` (always the next such day), `in 2 hours`,
`in 30 minutes`, `in 3 days`, `today`, `the day after tomorrow`, an ISO date;
German `morgen um 9`, `um 14 Uhr`, `am Freitag`, `in 2 Stunden`, `heute`,
`übermorgen`. A day without a time is due at 09:00; no time at all leaves
`dueAt: null`.

Every result also carries `withheld: [{ tool, label, source, permission }]`
for tools the role could not run; the same entries appear in
`answer.redactions` as `{ element: 'tool:<id>', reason }`, and a `withheld`
stage is in `trace`. When the whole plan is withheld the answer says so
("Not available for your role" / "Für Ihre Rolle nicht verfügbar").

Deterministic narration is German when `language` is `de` for: greeting,
capabilities, not-understood, daily summary, shift summary, issue summary,
top error codes, line issues, inbox, mail search, calendar, briefing, reminder
created, draft reply, Power BI measure, dashboard created. Other production
intents keep their English wording for now. Follow-up suggestions follow the
language. With Claude narration enabled the language is passed in the prompt.

German understood by the NLU: `heute`, `gestern`, `vorgestern`, `morgen`,
`diese Woche`, `letzte Woche`, `diesen/letzten Monat`, `letzten N Tage`,
`Montag`..`Sonntag`, `Frühschicht`/`Spätschicht`/`Nachtschicht`,
`Fehlercode`, `Nacharbeit`, `Stillstand`/`Ausfall`, `Wartung`, `Linie N`,
`Rohbau`/`Lackierlinie`/`Endmontage 1|2`, `Modell`, `Teil(e)`,
`Kostenstelle`, `Prüfpunkt`, `Fahrzeuge`, `kritisch`/`hoch`/`mittel`/`niedrig`.

---

## Voice

### `GET /api/voice/config?language=en|de`

Unchanged shape plus `language`, `stt: { provider, enabled }`. With
`language=de`: German `greeting.parts` labels (`Guten Morgen` / `Guten Tag` /
`Guten Abend`), `greeting.prompt` "Was möchten Sie wissen?", German
`followUpPrompt`, `notUnderstood`, `silence` and `examples`, and
`wake.prefixes` gains `hallo` and `he`. `greeting.honorific` stays `sir`.

### `POST /api/voice/tts`

Unchanged. `text` is forwarded to ElevenLabs as-is (the multilingual model
speaks German and English from the same voice).

### `POST /api/voice/stt?language=en|de`

Push-to-talk fallback for browsers without the Web Speech API. Send the raw
recording as the request body with `Content-Type: audio/webm`, `audio/ogg`,
`audio/mp4` or `audio/wav` (max 5 MB). The server forwards it to ElevenLabs
Speech-to-Text (`scribe_v1`) and returns:

```json
{ "text": "what problems did we have on friday", "language": "de" | "en", "detected": "eng" | null }
```

Without `ELEVENLABS_API_KEY` on the server:
`501 { "error": "stt_unavailable", "message": "Speech-to-text needs an ElevenLabs key on the server." }`
(check `stt.enabled` in the voice config to hide the button). A wrong body
or content type is `400`; an upstream failure is `502 stt_failed`. The key is
never logged or returned.

---

## Microsoft 365 live mode

Once the `microsoft365` connector is configured **and** enabled on the
Integrations page (`isLive('microsoft365')`), `secretary/provider.js` returns
the live provider from `server/src/connectors/microsoft365.connector.js` and
every mail/calendar route and agent tool above talks to Microsoft Graph for
the configured mailbox. The interface is identical to the mock, so the
responses keep the shapes documented at the top of this file; only `mode`
changes to `live` (and `simulated` becomes `live` on a sent reply).

**Authentication.** Client-credentials token from
`POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` with
scope `https://graph.microsoft.com/.default`, cached in memory until one
minute before it expires (concurrent calls share one token request). The
secret and the token are never logged.

**Calls** (all under `https://graph.microsoft.com/v1.0/users/{mailbox}`):

| Operation | Graph request |
| --- | --- |
| `listMail` | `GET /mailFolders/inbox/messages?$top=&$orderby=receivedDateTime desc&$select=...&$expand=singleValueExtendedProperties($filter=id eq 'Integer 0x1081')`; `$filter=isRead eq false` for `unread` and `needsReply`, `$filter=flag/flagStatus eq 'flagged'` for `flagged`; `$search="..."` for `q` (Graph does not combine `$search` with `$filter`/`$orderby`, so with a query the filter is applied in Jervis and the hits are re-sorted newest first). Inbox counters come from `GET /mailFolders/inbox` (`totalItemCount`, `unreadItemCount`), `$count=true` on the flagged filter, and the needs-reply heuristic over the newest 100 unread messages. |
| `getMail` | `GET /messages/{id}` (same `$select`/`$expand`); a Graph 404 is returned as `null`, so the route answers `404 not_found` exactly as in mock mode |
| `updateMail` | `PATCH /messages/{id}` with `{ isRead, flag: { flagStatus: 'flagged' \| 'notFlagged' } }` |
| `listEvents` | `GET /calendarView?startDateTime=&endDateTime=` for the civil day in the mailbox time zone, header `Prefer: outlook.timezone="W. Europe Standard Time"` (configurable via the `timezone` field, Windows or IANA name). `startsAt`/`endsAt` are converted to true ISO instants. |
| `sendReply` | `POST /messages/{id}/reply` with `{ comment: body }` -> `{ ok: true, mode: 'live', id }` |
| attachments | `GET /messages/{id}/attachments?$select=name,size`, only for messages with `hasAttachments` |

**Mapping.** `body` is `body.content`, with tags stripped and entities decoded
when `contentType` is `html`; `preview` is `bodyPreview` (140 chars);
`replied` reads the Outlook "last verb executed" property (102 reply,
103 reply-all); `category` is a keyword heuristic over sender and subject
that mirrors the mock categories (`supplier`, `maintenance`, `quality`, `hr`,
`meeting`, `it`, `other`).

**`needsReply` heuristic.** A message needs a reply when it is unread, has
not been replied to, is addressed to the mailbox in `To` (not only Cc), is
not a draft, and does not come from an automated sender (`noreply`,
`no-reply`, `donotreply`, `notifications`, `mailer-daemon`, `postmaster`).
Read messages are left to the user, so the live count is usually lower than
the mock inbox's.

**Errors.** Graph failures are never hidden behind mock data. A failed token
request, a 401/403 from Graph, a timeout (10 s) or a 5xx becomes
`502 { "error": "internal_error", "message": "Microsoft Graph ... failed (500): ..." }`
through the standard error handler (the thrown error carries `status`,
`statusCode` and a `code` such as `ms365_token`, `ms365_denied`,
`ms365_timeout`, `ms365_upstream`); a missing message on reply is
`404 request_error`.

---

## Power Automate

Two directions, both behind the `power_automate` connector on the
Integrations page (kind `automation`): Jervis **starts** approved flows after
an explicit confirmation, and flows **ask** Jervis questions through an
inbound endpoint. Nothing runs from a chat message alone: the agent only
proposes a flow (`result.automation`, see the tool below); the actual trigger
is a separate confirmed call.

Settings (`GET /api/integrations`): `triggerUrl` (secret - the HTTP-trigger
URL of an approved flow, it carries the signature), `inboundSecret` (secret),
`flowCatalog` (optional JSON list). Mock mode (not configured or not enabled)
lists three built-in sample flows and simulates every trigger; live mode
posts to the flow's `url`, or to the default `triggerUrl` when the catalog
entry has none.

Flow catalog format:

```json
[
  { "name": "escalate-quality-issue", "label": "Escalate a quality issue", "description": "...", "url": "https://prod-xx.westeurope.logic.azure.com/..." },
  { "name": "request-maintenance-visit", "label": "Request a maintenance visit" }
]
```

`name` is slugified (`Notify Shift Leads` -> `notify-shift-leads`); entries
without a name are skipped; invalid JSON falls back to the samples with a
warning in the server log. URLs are never returned to the browser.

**Probe** (`POST /api/integrations/power_automate/test`): in live mode posts
`{ "ping": true, "source": "jervis", "at": "<iso>" }` to the default trigger
URL and reports the status (200/202 = ok, 401/403 = signature rejected,
404 = no flow). Build the flow to answer a ping with 200 and do nothing else.
In mock mode nothing is called.

### `GET /api/automate/flows` - any signed-in user

```json
{ "items": [{ "name": "escalate-quality-issue", "label": "Escalate a quality issue", "description": "...", "mode": "mock" }], "mode": "mock" | "live" }
```

### `POST /api/automate/trigger` - manager (or any role holding `automate:run`)

Body `{ flow: string, payload?: object, confirm: boolean }`.

- unknown `flow` -> `404 not_found`; missing `flow` -> `400 request_error`;
- `confirm !== true` -> `400 { "error": "confirmation_required" }` (audited as `automate.trigger` / `refused`);
- mock mode -> `200 { "ok": true, "mode": "simulated", "runId": "run_...", "flow": "..." }` (audited `simulated`);
- live mode -> `POST <flow url>` with the envelope below, 10 s timeout:
  `200 { "ok": true, "mode": "live", "runId": "<from the flow's response: runId | run_id | id, else generated>", "flow", "status": 202 }` (audited `sent`), or
  `502 { "ok": false, "mode": "live", "runId", "flow", "status", "error": "Flow trigger returned 500." }` (audited `failed`).

Envelope the flow receives:

```json
{ "flow": "escalate-quality-issue", "payload": { "errorCode": "E-7781" }, "requestedBy": { "userId": "u_...", "role": "manager" }, "requestedAt": "2026-10-13T08:00:00.000Z" }
```

Permission note: the `automate:run` permission is checked as
`role === 'manager' || permissions.includes('automate:run')` until the
permission is added to the manager and engineer roles in
`server/src/security/roles.js` (TODO in `server/src/automate/index.js`).

### `POST /api/automate/inbound` - shared secret only

For flows that call Jervis (a Teams bot, a scheduled report, ...). It is
**not** behind the session: the only accepted credential is the header
`x-jervis-automate-secret` matching `inboundSecret` (constant-time compare).

- no secret configured -> `503 { "error": "automate_inbound_disabled" }`
- wrong or missing header -> `401 unauthorized` (audited `automate.inbound` / `refused`)
- more than 60 calls per minute from one address -> `429 rate_limited` (in memory)
- body `{ question: string (1-600), language?: 'en' | 'de', sessionId?: string }`

The question runs through the same `answerQuestion` as `POST /api/chat` with
a fixed service identity `{ userId: 'power-automate', role: 'engineer', via: 'automate' }`
(engineer permissions, so no cost figures, no audit trail, no integration
admin) and returns the same JSON as chat (`sessionId`, `answer`, `language`,
`interpretation`, ..., `access: { role: 'engineer' }`). A `sessionId` is
honoured only when it belongs to the service identity. Audited as
`automate.inbound` with the intent as resource and the question as detail;
the question is also in the query log.

### Tool `automate.trigger` (`permission: 'automate:run'`)

Side-effect free. Resolves the flow the user named (exact name, exact label,
or fuzzy word match: "escalate the quality problem" ->
`escalate-quality-issue`) and returns a proposal

```json
{ "automation": { "flow": "escalate-quality-issue", "label": "Escalate a quality issue", "payload": {}, "status": "proposed", "mode": "mock" }, "query": "...", "available": [...] }
```

(or `automation: null` with the available flows when nothing matched). The
orchestrator attaches it as `result.automation`; the client shows a confirm
button that calls `POST /api/automate/trigger` with `confirm: true`. The chat
intent that selects this tool (`TRIGGER_FLOW`) and its narration are the next
step; the tool is registered and unit-tested today.

---

## Integrations page

The connector `microsoft365` ("Microsoft 365 (mail and calendar)", kind
`mail-calendar`) appears in `GET /api/integrations` and `GET /api/sources`
with fields `tenantId`, `clientId`, `clientSecret` (secret), `mailbox` and
the optional `timezone`. `POST /api/integrations/microsoft365/test` acquires
an Entra ID token and calls Graph `GET /users/{mailbox}/mailFolders`. Once
configured and enabled the live calls described under "Microsoft 365 live
mode" replace the synthetic mailbox.

The connector `power_automate` ("Power Automate", kind `automation`) has
fields `triggerUrl` (secret), `inboundSecret` (secret) and `flowCatalog`; see
"Power Automate" above.

`GET /api/sources` tool entries now include `permission`.

---

## Environment variables (added to `server/.env.example`)

| Variable | Purpose |
| --- | --- |
| `MS365_TENANT_ID` | Entra ID tenant of the app registration |
| `MS365_CLIENT_ID` | Application (client) id with Mail.Read, Mail.Send, Calendars.Read |
| `MS365_CLIENT_SECRET` | Client secret (never returned to the browser) |
| `MS365_MAILBOX` | User principal name of the mailbox Jervis reads |
| `MS365_TIMEZONE` | Optional mailbox time zone for the calendar window and `Prefer: outlook.timezone` (default `W. Europe Standard Time`) |
| `POWER_AUTOMATE_TRIGGER_URL` | Default HTTP-trigger URL of an approved flow (secret; carries the signature) |
| `POWER_AUTOMATE_INBOUND_SECRET` | Shared secret flows send as `x-jervis-automate-secret`; inbound is disabled while empty |
| `POWER_AUTOMATE_FLOWS` | Optional JSON catalog of allowed flows (`[{ name, label, description?, url? }]`) |
| `JERVIS_TASKS_FILE` | Path of the task store (default `server/data/tasks.json`) |
| `JERVIS_DASHBOARDS_FILE` | Path of the dashboard store (default `server/data/dashboards.json`) |

Speech-to-text reuses `ELEVENLABS_API_KEY`; TTS additionally needs
`ELEVENLABS_VOICE_ID` as before. Both `server/data/tasks.json` and
`server/data/dashboards.json` are local state and should be gitignored
alongside `server/data/integrations.json`.

---

## Audit actions added

`mail.read`, `mail.update`, `mail.draft`, `mail.reply` (outcome `simulated` |
`sent` | `refused`), `calendar.read`, `task.read`, `task.create`,
`task.update`, `task.delete`, `briefing.read`, `dashboard.create`,
`dashboard.read`, `dashboard.delete`, `tool.withheld` (outcome `denied`),
`automate.trigger` (outcome `simulated` | `sent` | `failed` | `refused`),
`automate.inbound` (outcome `ok` | `refused`).
Visible to managers under `GET /api/audit` (`events`).
