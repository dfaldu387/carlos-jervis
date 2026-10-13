# Jervis — AI production assistant (prototype)

A working prototype of the assistant described in *Jervis AI Assistant — Project
Summary & Client Requirements*: ask a production question in plain language, and
get one consolidated answer drawn from the systems the plant already runs —
with every figure attributed to the system it came from.

React front end, Node back end. No database yet: the data layer sits behind one
contract so the real integration is a single adapter (`docs/DATA-LAYER.md`).

## Run it

```bash
npm install
npm run dev
```

- API — http://localhost:4010
- UI — http://127.0.0.1:5180

```bash
npm test          # 72 server tests
npm run build     # production build of the UI
```

Configuration is optional; copy `server/.env.example` to `server/.env` to
change anything. The defaults run fully offline on a synthetic data set.

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

## Command Center

The landing view: one screen of what is true on the floor right now, with the
voice core at the middle.

| Panel | What it actually shows |
| --- | --- |
| Core overview | Understanding, planner, connectors, data layer, narration, voice — each with its real state |
| Jervis core | The voice conversation: wake state, live transcript, what Jervis just said |
| Live intelligence feed | Today's critical codes, vehicles removed, top error code, open maintenance, longest stop, worst line — **every row is clickable and asks Jervis that question** |
| Connected systems | The five connectors and whether each is live, mock or planned |
| Shift timeline | The three shifts with issue counts; the running one is marked |
| Quick commands | Daily summary, problems today, rework, downtime, start voice chat |
| Production monitor | First pass yield, rework share, downtime share as radial meters |
| Issue trend | 14-day issues-per-day line |
| Source and model status | Narration provider plus each connector |

It refreshes every 60 seconds and is served by a single `/api/command-center`
call, so the panels are one snapshot rather than eight that disagree.

**Two display skins**, switched in the sidebar: **Command Center** (the dark
HUD, default) and **Plain** (the high-contrast light/dark theme). The skin only
redefines design tokens, so every page works under both — pick Plain if the
glow gets in the way on a shop-floor screen.

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

Recognition and synthesis are the browser's own (Chrome or Edge; Firefox has no
speech recognition and falls back to the text box). No audio leaves the machine.
The wake phrase, greeting, prompts and timings come from `/api/voice/config`, so
the wording can change without a front-end release.

Spoken answers are a separate, shorter form of the same facts — headline, one
paragraph, one warning — with shorthand expanded for the ear ("64 h 43 min"
becomes "64 hours 43 minutes", `E-5007` is read digit by digit). The screen
still shows the full answer with its tables.

## Layout

```
server/
  src/
    agent/         nlu · planner · tools · orchestrator · synthesizer · llm
    connectors/    Databricks · Power BI · Integral Portal · MQTT registry
    data/          repository contract, adapters, synthetic warehouse
    auth/          users, sessions, login/logout
    security/      roles, redaction, audit trail
    routes/        auth · chat · summaries · system · dashboard · issues · analytics · conversations · integrations
  test/            72 tests across agent, API, auth, data endpoints, voice, command centre, integrations
web/
  src/
    pages/         Overview · Ask Jervis · Issues · Analytics · Shift Reports · Data Sources · Integrations · History · Audit · Settings · Help · Profile
    components/    voice conversation loop, answer card, charts, gauges, tables, KPI tiles
    styles/        app.css (plain skin) · hud.css (Command Center skin)
db/schema.sql      target schema for the database integration
docs/              data-layer guide, requirements coverage
```

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/chat` | Ask a question. Body `{ message, sessionId? }` |
| `GET` | `/api/chat/:sessionId` | Replay a conversation |
| `GET` | `/api/summaries/daily?date=&line=` | Day summary, no question needed |
| `GET` | `/api/summaries/shift?date=&shift=S1` | Shift summary |
| `GET` | `/api/summaries/overview?days=14&line=` | Dashboard figures |
| `GET` | `/api/catalog` | Dimensions the assistant understands |
| `GET` | `/api/sources` | Connector registry with integration mode |
| `GET` | `/api/suggestions` | The supported question set |
| `GET` | `/api/voice/config` | Wake phrase, greeting, prompts, timings |
| `GET` | `/api/command-center` | Every command-centre panel in one snapshot |
| `GET` | `/api/roles` | Roles and permissions |
| `GET` | `/api/integrations` | Connector config with secrets masked (manager only) |
| `PUT` | `/api/integrations/:id` | Save credentials and the enabled flag (manager only) |
| `POST` | `/api/integrations/:id/test` | Run the connection probe now (manager only) |
| `GET` | `/api/audit` | Query and administrative audit trail (manager role only) |
| `GET` | `/api/health` | Status, active data source, dataset size |

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

A prototype for the discovery phase, not a deployment. `docs/REQUIREMENTS-COVERAGE.md`
sets out, section by section, what is built, what is stood in for with mock
connectors and synthetic data, and what the requirements document deliberately
leaves open — the existing-chatbot decision, the authorisation model, hosting,
performance targets and the final question set.
