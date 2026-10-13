# Jervis — AI secretary for daily plant work (prototype)

Jervis is an AI assistant for a vehicle plant that behaves like a secretary
rather than a reporting tool: ask it questions in plain language (English or
German), let it read your mailbox and calendar, keep your tasks, give you a
daily briefing, pull targeted figures from Power BI and the other connected
systems, and build simple dashboards on request. Every figure names the system
it came from, every action is audited, and nothing is sent on your behalf
without an explicit confirmation.

React + TypeScript front end, Node + Express back end. No database yet: the data
layer sits behind one contract so the real integration is a single adapter
(`docs/DATA-LAYER.md`). All connectors, including the mailbox, run in mock mode
on a synthetic data set until real credentials are added.

## Setup

Requirements: Node.js 20 or newer (24 is what we develop on) and npm 10+. No
database, Docker, or cloud account is needed for the prototype.

```bash
git clone https://github.com/dfaldu387/carlos-jervis.git
cd carlos-jervis
npm install
npm run dev
```

`npm run dev` installs missing dependencies on its own, frees ports 4010 and
5180 if a stale process is holding them, then starts both servers:

- UI — http://127.0.0.1:5180 (open this one)
- API — http://localhost:4010

Sign in with one of the demo accounts shown on the login screen (also listed
under *Sign in* below), then try: *"What do I need to know today?"*,
*"Which emails need a reply?"*, *"Any critical problems this week?"*,
*"Create a dashboard for Paint Line 2 this week"*, or in German
*"Was steht heute an?"*. Say **"Hey Jervis"** with the microphone on to use it
hands-free (Chrome or Edge; other browsers get a hold-to-talk button).

Other commands:

```bash
npm test          # server test suite
npm run build     # production build of the UI into web/dist
npm run free-ports
```

### Configuration

Everything runs offline by default. To change anything, copy
`server/.env.example` to `server/.env` and edit it; every variable is
documented inline there. The ones you are most likely to touch:

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | API port | `4010` |
| `JERVIS_LLM_PROVIDER`, `ANTHROPIC_API_KEY` | `claude` turns on AI-written narration; figures still come from retrieval | deterministic templates |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | Spoken answers with an ElevenLabs voice; the key also enables server-side speech-to-text for browsers without the Web Speech API | browser voice |
| `DATABRICKS_*`, `POWERBI_*`, `INTEGRAL_PORTAL_*`, `MQTT_*` | Live connectors; each stays in mock mode until its required values are set *and* it is enabled on the Integrations page | mock |
| `MS365_*` | Microsoft 365 mailbox and calendar (Microsoft Graph); mock mailbox until set | mock |
| `JERVIS_DATA_SOURCE`, `DATABASE_URL` | `postgres` or `databricks` instead of the bundled synthetic data | `memory` |

Connector values can also be entered at runtime on the Integrations page by a
manager; saved values win over the environment and are kept in
`server/data/integrations.json`, which is git-ignored because it may hold
secrets. Tasks and saved dashboards persist to `server/data/*.json` the same way.

### Using it from another device on the LAN

`deploy/nginx/` holds an nginx config and helper scripts that front both
servers on port 80, so the app can be opened from a phone or a colleague's
machine on the same network. See the comments in `deploy/nginx/jervis.conf`.

## What it does

Ask *"What problems did we have on Friday?"* and the assistant:

1. **Understands** the question — intent, period, shift, line, model, error
   code, part, checkpoint, cost centre, severity.
2. **Decides which systems to read**, from an explicit plan rather than model
   improvisation, so the choice is reviewable per question.
3. **Retrieves** from each one — issue history, Power BI measures, Integral
   Portal maintenance tickets, MQTT downtime signals.
4. **Combines** the results and **answers**: a headline, a short narrative, KPI
   tiles, charts, supporting tables, and links back to the owning dashboard or
   application.
5. **Shows its work** — every answer carries its sources and a stage-by-stage
   trace, and every tile names the system behind the number.

The interface is an enterprise dashboard: a navy sidebar with grouped
navigation, a compact top bar with search, system status, notifications and an
account menu, and a spacious content area. It uses the Inter typeface and
Lucide icons, and ships three display skins — **Enterprise** (default, light),
**Command Center** (dark HUD) and **Plain** (high contrast) — switchable under
Settings.

Twelve pages, grouped in the sidebar:

- **Workspace** — Overview (operational dashboard with KPI cards and charts),
  Ask Jervis (voice and text chat), Production Issues (searchable, filterable,
  paginated table with a detail drawer), Production Analytics (trends and
  breakdowns), Shift Reports (generate day/shift summaries).
- **Data & Systems** — Data Sources (what is connected, in which mode) and
  Integrations (configure, test and enable each source).
- **Activity** — Conversation History (reopen and continue past questions) and
  Audit Logs (query and administrative trail, manager only).
- **Account** — Settings, Help & Documentation, and User Profile.

Every data page handles loading, empty, error, permission and demo states, and
synthetic data is labelled wherever it appears.

## The assistant pages

The home screen is **Ask Jervis**: the voice core on the left, the
conversation on the right, a chat input underneath. Everything Jervis says,
typed or spoken, lands in that conversation. The other three assistant pages
are the secretary's desk:

| Page | What it does |
| --- | --- |
| **Today** | The daily briefing — calendar, mail that needs a reply, open and overdue tasks, what happened on the lines, open maintenance — with a *Read it to me* button. Add, complete and delete tasks here. |
| **Inbox** | Jervis reads the mailbox: filters for unread, needs-reply and flagged; opens a message; drafts a reply you can edit; sending always asks *"Send this reply to …?"* first. One click turns a mail into a task. |
| **My Dashboards** | Describe a dashboard in plain language ("Create a dashboard for Paint Line 2 this week") and Jervis assembles KPI tiles, bar, line and pie widgets from the connected sources for that period. Saved dashboards recompute on open. |

The same things work from the chat: *"what do I need to know today"*,
*"which emails need a reply"*, *"remind me to call the supplier tomorrow at
9"*, *"what is the first pass yield in Power BI"*, *"create a dashboard of the
top error codes this month"* — each answer carries the structured result
(mail list, calendar, tasks, dashboard link, measure) under the narrative.

The production reporting pages (Overview, Issues, Analytics, Shift Reports)
are still there under **Reports** in the sidebar.

**English and German.** The EN / DE switch in the header changes the UI, the
language Jervis answers in, the voice it speaks with and the language it
listens for. German questions work with the same intents ("Was steht heute
an?", "Welche Fehlercodes gab es diese Woche?", "Erinnere mich morgen um 9 …").

Questions it answers today are listed in the UI and at `/api/suggestions`.

## Hands-free voice

Turn on voice mode once, then talk:

```
  You: "Hey Jervis"
  Jervis: "Good morning, sir! What would you like to know?"
  You: "What problems did we have on Friday?"
  Jervis: "52 problems recorded on Friday 2026-10-02. There were 52 issue
           events affecting 45 vehicles..."
  Jervis: "Anything else?"
  You: "Which models were affected?"     ← no wake phrase needed
```

The opening is built from the listener's own clock at the moment of waking:
**Good morning** from 05:00, **Good afternoon** from 12:00, **Good evening**
from 17:00, and **Good evening** again through the 22:00-06:00 night shift -
someone three hours into a night shift has not just woken up. The honorific is
one config value (`server/src/agent/greeting.js`), so it can be set per user or
emptied to "Good morning!".

The panel at the top of the Assistant shows which of the four steps —
**Wake → Ask → Retrieve → Answer** — is live, and what Jervis thinks it heard,
so there is never any doubt about whether the microphone is open.

- **Wake phrase** `Hey Jervis`, also bare "Jervis" and the mis-hearings speech
  recognition actually produces ("hey jarvis", "hey service").
- **Greeting first** - the time-of-day greeting is spoken before anything is
  retrieved, so the wake is acknowledged immediately rather than after a query.
- **Ask in one breath** — "Hey Jervis, what problems did we have on Friday?"
  skips the greeting and answers straight away.
- **Follow-ups** need no wake phrase for 9 seconds after an answer, which is
  what makes it a conversation rather than a series of commands.
- **Ask without the wake phrase** button, for a noisy line.

Recognition and synthesis are the browser's own in Chrome and Edge, so no audio
leaves the machine. Browsers without the Web Speech API (Firefox, some locked
down builds) get a **hold-to-talk** button instead: the recording is sent to
`POST /api/voice/stt` and transcribed server-side with ElevenLabs when an API
key is configured; without one the button explains that typing is the way in.
The wake phrase, greeting, prompts and timings come from `/api/voice/config`,
in English or German, so the wording can change without a front-end release.
Slow or mangled renderings of the name ("hey jer vis", "jarviss") still wake
it: results from the last four seconds are stitched together and matched
fuzzily.

Spoken answers are a separate, shorter form of the same facts — headline, one
paragraph, one warning — with shorthand expanded for the ear ("64 h 43 min"
becomes "64 hours 43 minutes", `E-5007` is read digit by digit). The screen
still shows the full answer with its tables.

## Layout

```
server/
  src/
    agent/         nlu (EN + DE) · planner · tools · orchestrator · i18n · llm
    secretary/     mock mailbox + calendar, tasks store, daily briefing
    dashboards/    dashboards built from questions, persisted to server/data
    connectors/    Databricks · Power BI · Integral Portal · MQTT · Microsoft 365 registry
    data/          repository contract, adapters, synthetic warehouse
    auth/          users, sessions, login/logout
    security/      roles + permissions, redaction, audit trail
    routes/        auth · chat · secretary · dashboards · summaries · system · issues · analytics · conversations · integrations · voice
  test/            node:test suites across agent, API, auth, secretary, dashboards, German NLU
web/
  src/
    pages/         Ask Jervis · Today · Inbox · My Dashboards · Overview · Issues · Analytics · Shift Reports · Data Sources · Integrations · History · Audit · Settings · Help · Profile
    components/    Jervis core + face, answer card with secretary payloads, floating voice button, charts, tables
    hooks/         use-voice (wake word, continuous recognition, push-to-talk fallback), voice-provider, use-auth
    lib/           api client, i18n (EN/DE dictionaries), types
  public/          jervis-face.mp4 (the animated helmet)
deploy/nginx/      LAN access through nginx
db/schema.sql      target schema for the database integration
docs/              data layer, access model, secretary API, requirements coverage
```

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/chat` | Ask a question. Body `{ message, sessionId?, language? }` |
| `GET` | `/api/chat/:sessionId` | Replay a conversation |
| `GET` | `/api/summaries/daily?date=&line=` | Day summary, no question needed |
| `GET` | `/api/summaries/shift?date=&shift=S1` | Shift summary |
| `GET` | `/api/summaries/overview?days=14&line=` | Dashboard figures |
| `GET` | `/api/catalog` | Dimensions the assistant understands |
| `GET` | `/api/sources` | Connector registry with integration mode |
| `GET` | `/api/suggestions` | The supported question set |
| `GET` | `/api/voice/config?language=` | Wake phrase, greeting, prompts, timings (EN or DE) |
| `GET` | `/api/roles` | Roles and permissions |
| `GET` | `/api/integrations` | Connector config with secrets masked (manager only) |
| `PUT` | `/api/integrations/:id` | Save credentials and the enabled flag (manager only) |
| `POST` | `/api/integrations/:id/test` | Run the connection probe now (manager only) |
| `GET` | `/api/audit` | Query and administrative audit trail (manager role only) |
| `GET` | `/api/health` | Status, active data source, dataset size |
| `GET` | `/api/secretary/mail?filter=&q=` | Mailbox list with unread / needs-reply counts (mock until Microsoft 365 is configured) |
| `GET` `PATCH` | `/api/secretary/mail/:id` | One message; mark read / flagged |
| `POST` | `/api/secretary/mail/:id/draft` | Draft a reply (never sends) |
| `POST` | `/api/secretary/mail/:id/reply` | Send a reply — refused without `confirm: true`; simulated until the mailbox is live |
| `GET` | `/api/secretary/calendar?day=` | Calendar entries for a day |
| `GET` `POST` `PATCH` `DELETE` | `/api/secretary/tasks` | Reminders and tasks |
| `GET` | `/api/secretary/briefing?language=` | The daily briefing with a spoken version |
| `GET` `POST` | `/api/dashboards` | Saved dashboards; create one from a question |
| `GET` `DELETE` | `/api/dashboards/:id` | One dashboard, widgets recomputed on read |
| `POST` | `/api/voice/stt?language=` | Push-to-talk transcription (needs an ElevenLabs key; 501 otherwise) |

Full payloads for the secretary and dashboard endpoints are in
`docs/SECRETARY-API.md`; the roles and permissions behind them are in
`docs/ACCESS-MODEL.md`.

## Sign in

The app opens on a sign-in screen. Authentication is a real server-side
session: a valid login sets an opaque, httpOnly cookie, every protected route
and AI tool is denied by default without it, and signing out revokes it. Three
demo accounts (synthetic data, local only) appear on the screen as one-click
fills:

| Account | Password | Role |
| --- | --- | --- |
| `manager@jervis.local` | `Manager!2026` | Production manager |
| `engineer@jervis.local` | `Engineer!2026` | Quality engineer |
| `viewer@jervis.local` | `Viewer!2026` | Line viewer |

The role comes from the signed-in user and is enforced on the server, so a
lower-privileged account genuinely cannot see cost figures, the audit trail, or
the integration settings. Passwords are scrypt-hashed, login is rate-limited
per address, and one user cannot read another's conversation.

For local development and the test suite there is a header shortcut: send
`x-jervis-role: manager|engineer|viewer` to skip the login. It is refused when
`NODE_ENV=production`, where a real session is the only way in.

| Endpoint | Purpose |
| --- | --- |
| `POST /api/auth/login` | `{ email, password }` → sets the session cookie |
| `POST /api/auth/logout` | Revoke the session |
| `GET /api/auth/me` | The current user, or 401 |
| `GET /api/auth/demo-accounts` | The seeded demo logins for the sign-in screen |

## Integrations

The **Integrations** page configures each system Jervis connects to. For every
source it shows the fields it needs, stores credentials on the server, runs a
real connection probe, and reports the outcome:

| System | Probe | Live data path |
| --- | --- | --- |
| Databricks | Reads the SQL warehouse, then `SELECT 1` via the Statement Execution API | `JERVIS_DATA_SOURCE=databricks` answers every question with SQL against the warehouse |
| Power BI | Acquires an Entra ID token, lists the workspace reports | Report deep links; measures via a configured DAX query |
| Integral Portal | Calls the health path with the API key | Maintenance tickets read from the portal |
| MQTT Explorer | Opens a TCP/TLS session and completes an MQTT CONNECT handshake | Downtime events from the broker |
| Existing chatbot | Requests the application URL | Link only; architecture decided in discovery |

Rules the page enforces:

- **Secrets never leave the server.** A saved secret is shown only as whether
  it is set and its last four characters; re-saving with the field blank keeps
  the stored value.
- **Live means configured and enabled.** A connector stays on synthetic data
  until its required fields are present *and* a manager turns on the live
  connection. The mode shown everywhere else follows this.
- **Manager only.** Every integration route is behind the `integrations:manage`
  permission, enforced on the server. Engineers and viewers get a 403.
- **No false positives.** A probe reports success only when the system returns
  a response that actually belongs to it, not merely an HTTP 200.

Credentials resolve from two layers: the environment (seeded from
`server/.env`) and a runtime overrides file (`server/data/integrations.json`,
gitignored) that the page writes. Saved values win, so a connector can be
configured without editing env files, and a locked-down deployment can run on
env alone.

## Data

28 days of synthetic production history, generated from a fixed seed so every
boot and every demo is identical: ~930 issue events across 4 lines, 3 shifts, 5
vehicle models, 9 error codes, 8 parts, 5 checkpoints and 5 cost centres, plus
maintenance tickets and downtime events. No Mercedes data is used anywhere,
which is what the access constraint in the requirements calls for at this stage.

`JERVIS_REFERENCE_DATE` pins "today" if you need the demo to sit on a fixed day.

## Narration

Answers are composed deterministically by default — no API calls, reproducible,
and every number traceable to a retrieval step. Setting

```
JERVIS_LLM_PROVIDER=claude
ANTHROPIC_API_KEY=sk-ant-...
```

routes the retrieved facts through Claude (`claude-opus-5-5`) to reword the
narrative for a management reader. The model receives the facts only and is
instructed not to introduce figures; on any failure or refusal the deterministic
text is used unchanged. Numbers never come from the model.

## Status

Prototype, aligned with the client review of October 2026: an AI secretary
first, reporting second. Working today against mock data: questions in English
and German, the daily briefing, mailbox triage with drafted replies and a
confirmation step, calendar, reminders, targeted Power BI measures, dashboards
on request, hands-free voice with a push-to-talk fallback, role-based access
enforced per route and per retrieval tool, and a full audit trail. 110 server
tests pass.

Not yet live: the Microsoft 365 mailbox (Graph calls are stubbed until a test
mailbox is agreed), single sign-on, the Power BI / Databricks connectors
(credentials needed), and the document retrieval layer (`docs/RAG-DESIGN.md`).
The proposed next steps and the open questions for the client are in
`docs/SECRETARY-SCOPE.md`.
