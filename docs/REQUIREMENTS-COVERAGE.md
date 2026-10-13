# Requirements coverage

Section numbers refer to *Jervis AI Assistant — Project Summary & Client
Requirements* (the October 5 meeting summary). This records what the prototype
actually does, what it stands in for, and what the document itself leaves open.

## Built and working

| § | Requirement | Where it lives |
| --- | --- | --- |
| 4.1 | Understand natural-language questions | `server/src/agent/nlu.js` — intent + entity extraction, 18 intents, period/shift/line/model/code/part/checkpoint/cost-centre/severity recognition |
| 4.1 | Determine what information is required | `server/src/agent/planner.js` — an explicit intent→retrieval plan, auditable per question |
| 4.1 | Search or retrieve relevant information | `server/src/agent/tools/` — 10 retrieval tools across 4 systems |
| 4.1 | Combine information from different sources | `server/src/agent/orchestrator.js` — runs the plan, merges results, records a trace |
| 4.1 | Provide a clear response | `server/src/agent/synthesizer.js` — headline, narrative, KPI tiles, charts, tables |
| 4.1 | Produce useful summaries for management | `/api/summaries/daily`, `/api/summaries/shift`, the Summaries page |
| 4.2 | Work with production issues, symptoms, error codes, reworked vehicles, vehicles affected, cost centres, parts, shifts, rework categories, checkpoints, models, time | `server/src/data/catalog.js` + `seed.js` — every dimension the meeting demonstrated |
| 4.2 | The listed example questions | All ten answer; `/api/suggestions` lists the supported set, `server/test/nlu.test.js` pins the parsing |
| 5 | Daily and shift-based summaries over 06:00–14:00 / 14:00–22:00 (and 22:00–06:00) | `utils/dates.js` shift model, `issues.byShift` tool, Summaries page |
| 6 | Power BI: access dashboard information, find what relates to the question, interpret it, include it, direct the user to the report | `connectors/powerbi.connector.js` — measures + report deep links; every answer links back rather than replacing the dashboard |
| 8 | Work across multiple internal systems | `connectors/index.js` — Databricks, Power BI, Integral Portal, MQTT Explorer, existing chatbot, each with its mode and access route |
| 6, 8 | Configure, test and enable each integration | `integrations/` + the Integrations page — per-system credential forms, server-side secret storage, real connection probes (Statement Execution API, Entra ID token, portal health check, MQTT CONNECT), and a configured/enabled→live rule |
| 6 | Live Databricks data path | `data/adapters/databricks.adapter.js` — the full repository contract over the SQL warehouse, selected with `JERVIS_DATA_SOURCE=databricks` |
| 9 | Cross-system retrieval workflow | The orchestrator implements the document's exact flow; the Systems page and every answer's trace show it per question |
| 11 | Voice and text | `web/src/components/useSpeech.js` — dictation and spoken answers via the browser's Web Speech API, text always available |
| 12 | Controlled access, restricted information, sanitised data | Synthetic data set only; roles + permissions (`security/roles.js`), retrieval-time redaction (`security/redaction.js`), per-question audit trail (`security/audit.js`) |
| 12 | Authenticated sign-in and server-enforced authorization | `auth/` + `middleware/access.js` — session login (scrypt-hashed passwords, httpOnly cookie), deny-by-default on every protected route, login rate limiting, and conversation ownership so one user cannot read another's session |
| 17 | Source citations / traceability | Every answer carries its sources and a stage-by-stage trace; every KPI tile names its system |
| 21 | All nine pilot success criteria | Criteria 1–7 are demonstrable in the UI; 8 holds because nothing internal is touched; 9 is what this prototype is for |

## Stood in for

These are implemented against synthetic data or a mock connector, which is what
§12 (no unrestricted access) and §18 require at this stage.

- **Databricks** — the in-memory warehouse plays the SQL warehouse. Swap:
  one adapter, see `docs/DATA-LAYER.md`.
- **Power BI** — measures are computed from the same data set and returned in
  the shape `executeQueries` returns. Report names, workspaces and URLs are
  placeholders.
- **Integral Portal** — maintenance tickets are synthetic.
- **MQTT Explorer** — downtime events are synthetic; the topic pattern
  (`plant1/<line>/<asset>/state`) is a guess to be confirmed.
- **Live credentials** — the connection probes and the Databricks data path
  are real code; they stay in mock mode only because no credentials have been
  supplied and enabled on the Integrations page. Supply them and the same code
  reaches the real system.
- **Authentication** — a real server-side session login now gates the app
  (`auth/`), with scrypt-hashed demo accounts seeded in `auth/users.js`. What
  is stood in for is the identity source: swap the seeded user store for SSO /
  Entra ID claims. The session, permission enforcement, rate limiting and
  conversation ownership stay as they are.
- **Narration** — deterministic templates by default. Setting
  `JERVIS_LLM_PROVIDER=claude` routes the retrieved facts through the Claude
  Messages API for wording only; the model is instructed not to introduce
  figures and the deterministic text is the fallback on any failure.

## Deliberately not decided here

§17 lists these as open, and the prototype does not pretend to settle them. It
is built so each stays a local change:

- **Extend the existing chatbot, reuse it, integrate with it, or wrap it**
  (§10) — registered as a connector in `planned` mode. The decision belongs to
  discovery.
- **Exact LLM / RAG architecture** — the retrieval path is deterministic and
  tool-based; a RAG index would be an additional tool, not a replacement.
- **Database and hosting architecture** — `docs/DATA-LAYER.md`.
- **Authorisation model and user roles** — three roles are a placeholder with
  the right shape, not a proposal.
- **The final supported question set** — `/api/suggestions` is the current
  surface, to be confirmed with the client.
- **Performance, SLA, concurrency, retention, monitoring** — not addressed.
  Answer latency is reported per question (`elapsedMs`) so the real figures can
  be measured as integrations land.
- **Automated notifications and scheduled summaries** — the summary endpoints
  exist and need no question, which is the half a scheduler would call; no
  scheduler is included.

## Commercial / process items

§13 (collaborative working model), §14 (phases), §19 (rate), §22 (next steps)
are process, not software. The one software-relevant consequence is that this
prototype is built to be read and changed with the client in the room: no
hidden model behaviour in the retrieval path, an explicit plan per question,
and a visible trace for every answer.
