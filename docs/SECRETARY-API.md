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

## Integrations page

A new connector `microsoft365` ("Microsoft 365 (mail and calendar)", kind
`mail-calendar`) appears in `GET /api/integrations` and `GET /api/sources`
with fields `tenantId`, `clientId`, `clientSecret` (secret), `mailbox`.
`POST /api/integrations/microsoft365/test` acquires an Entra ID token and
calls Graph `GET /users/{mailbox}/mailFolders`. Even when configured and
enabled, the live mail/calendar calls are stubbed (`501 ms365_not_wired`)
until the mailbox scope is agreed with the client - see
`server/src/connectors/microsoft365.connector.js`.

`GET /api/sources` tool entries now include `permission`.

---

## Environment variables (added to `server/.env.example`)

| Variable | Purpose |
| --- | --- |
| `MS365_TENANT_ID` | Entra ID tenant of the app registration |
| `MS365_CLIENT_ID` | Application (client) id with Mail.Read, Mail.Send, Calendars.Read |
| `MS365_CLIENT_SECRET` | Client secret (never returned to the browser) |
| `MS365_MAILBOX` | User principal name of the mailbox Jervis reads |
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
`dashboard.read`, `dashboard.delete`, `tool.withheld` (outcome `denied`).
Visible to managers under `GET /api/audit` (`events`).
