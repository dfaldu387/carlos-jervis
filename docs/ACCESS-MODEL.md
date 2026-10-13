# Access model

How Jervis decides who may see what and who may trigger which action. The
model is enforced on the server at two levels (route and tool), every read and
write is audited, and nothing with a side effect outside Jervis happens
without an explicit confirmation. The role source is a seeded user store for
the prototype; the section at the end says where SSO / Entra ID claims plug
in without touching the enforcement.

## Roles

| Role | Id | Who | Summary |
| --- | --- | --- | --- |
| Line viewer | `viewer` | Shop-floor staff | Issues, rework and downtime; own calendar and reminders. No mailbox, no maintenance detail, no identifiers, no cost. |
| Quality engineer | `engineer` | Quality / process engineers | Full production detail incl. VINs, suppliers and maintenance; full secretary (mail, calendar, tasks, briefing) and dashboards. |
| Production manager | `manager` | Plant / production management | Everything an engineer has, plus cost figures, the audit trail and integration administration. |

Defined in `server/src/security/roles.js`.

## Permissions

| Permission | Guards | viewer | engineer | manager |
| --- | --- | :-: | :-: | :-: |
| `production:read` | Issue history, rework, downtime, Power BI measures and report list, dashboards (read) | x | x | x |
| `vehicle:read` | Vehicle identifiers (VIN column) | | x | x |
| `supplier:read` | Supplier names on parts | | x | x |
| `maintenance:read` | Integral Portal tickets | | x | x |
| `finance:read` | Cost figures, cost-center report, `rework_cost` measure | | | x |
| `audit:read` | Query and event audit trail (`GET /api/audit`) | | | x |
| `integrations:manage` | Connector credentials, enable flags, connection probes | | | x |
| `mail:read` | Read the mailbox, search it, draft replies (drafting never sends) | | x | x |
| `mail:write` | Mark read / flagged, send a reply (with explicit confirm) | | x | x |
| `calendar:read` | Calendar events and the daily briefing | x | x | x |
| `tasks:write` | Create, update, complete, delete reminders (implies reading them) | x | x | x |
| `dashboards:write` | Create and delete on-request dashboards | | x | x |

`GET /api/auth/me` returns the signed-in user's `permissions` array so the UI
can hide what the server would refuse anyway.

## What each role may query

Sources and the tools over them, with the permission each tool declares
(`server/src/agent/tools/index.js`):

| Source | Tool | Permission |
| --- | --- | --- |
| Databricks (issue history) | `issues.search`, `issues.aggregate`, `issues.vehicleImpact`, `issues.rework`, `issues.trend`, `issues.byShift` | `production:read` |
| Power BI | `powerbi.measures`, `powerbi.reports`, `powerbi.measure` | `production:read` (cost measures additionally need `finance:read`) |
| MQTT telemetry | `telemetry.downtime` | `production:read` |
| Integral Portal | `maintenance.tickets` | `maintenance:read` |
| Microsoft 365 mailbox | `mail.search`, `mail.needsReply`, `mail.draft` | `mail:read` |
| Microsoft 365 calendar | `calendar.events`, `briefing.compose` | `calendar:read` (the briefing adds only the sections the role may see) |
| Jervis tasks | `tasks.due`, `tasks.create` | `tasks:write` |
| Jervis dashboards | `dashboard.create` | `dashboards:write` |

So a viewer asking "what's in my inbox" gets an answer that says the mailbox
is not available for their role, nothing is read, and the refusal is audited.
A viewer asking for a daily summary gets issues, rework and downtime, with the
maintenance tickets listed as withheld.

## What each role may trigger

| Action | Permission | Side effect | Confirmation |
| --- | --- | --- | --- |
| Mark mail read / flagged | `mail:write` | Mailbox state | none |
| Draft a reply | `mail:read` | none (draft is returned, never stored or sent) | none |
| Send a reply | `mail:write` | Mail leaves the mailbox (simulated in mock mode) | **`confirm: true` required**, otherwise `400 confirmation_required` |
| Create / update / delete a task | `tasks:write` | Task store | none |
| Create / delete a dashboard | `dashboards:write` | Dashboard store | none |
| Change integration settings, run a probe | `integrations:manage` | Credentials saved, outbound call to the system | none (manager only) |

The rule for mail is absolute: **sending always requires an explicit
confirmation from the user**, in the API (`confirm: true`) and therefore in
every UI built on it. The agent can draft but has no tool that sends; the only
send path is `POST /api/secretary/mail/:id/reply`, and the draft route is
documented as never sending.

## How enforcement works

1. **Authentication** - `attachAccess` (`server/src/middleware/access.js`)
   resolves the session cookie to a user and role. In development and tests
   the `x-jervis-role` header is accepted; it is refused in production.
2. **Route level** - every router is mounted behind `requireAuth`, and each
   route that touches guarded data adds `requirePermission('<permission>')`.
   A missing permission is a `403` with the permission named, before any
   handler runs.
3. **Tool level** - the orchestrator (`server/src/agent/orchestrator.js`)
   checks each planned tool's `permission` against the role before running
   it. A tool the role may not use is skipped and reported three ways: in
   `result.withheld` (`{ tool, label, source, permission }`), in
   `answer.redactions` as `tool:<id>` next to redacted columns, and as a
   `withheld` stage in the trace. The planner additionally drops the cost
   measure step for roles without `finance:read`.
4. **Field level** - `redactAnswer` (`server/src/security/redaction.js`)
   masks VINs, supplier names and cost columns after retrieval, so even a
   permitted tool cannot leak a restricted column.
5. **Data level** - the briefing composer and the Power BI connector take the
   role's permissions and simply do not read the sections or measures the
   role may not see.

## What is audited

`server/src/security/audit.js` keeps two logs (manager-only, `GET /api/audit`):

- **Query log** (`recordQuery`): every chat question with role, intent,
  period, sources read, tools used, redactions and narration provider.
- **Event log** (`recordAudit`): actor, action, resource, outcome, detail.
  Actions recorded by the secretary and dashboard features:
  `mail.read`, `mail.update`, `mail.draft`, `mail.reply` (outcome
  `simulated` | `sent` | `refused`), `calendar.read`, `task.read`,
  `task.create`, `task.update`, `task.delete`, `briefing.read`,
  `dashboard.create`, `dashboard.read`, `dashboard.delete`, and
  `tool.withheld` (outcome `denied`) whenever the agent skips a tool for lack
  of permission. Existing actions (`auth.login`, `auth.logout`,
  `integration.update`, `integration.test`, ...) are unchanged.

Reads are audited as well as writes: a mailbox listing by the agent and one by
the REST route both appear as `mail.read`.

## Where SSO / Entra ID plugs in

The role is the only thing the enforcement needs. Today it comes from
`server/src/auth/users.js` (seeded demo accounts). With Entra ID:

- Validate the id token / access token in `attachAccess` and map group or app
  role claims (`roles`, `groups`) to `viewer` / `engineer` / `manager` in one
  place: `resolveAccess(roleId, userId)` in `security/roles.js`.
- The mailbox the secretary reads becomes the signed-in user's own (`/me`)
  instead of the configured `MS365_MAILBOX`, using on-behalf-of flow; the
  connector interface does not change.
- Nothing in the routes, tools, redaction or audit changes, because none of
  them look at how the role was obtained.

## Mock vs live

Every connector answers from synthetic data until its credentials are set
**and** it is enabled on the Integrations page (`isLive()` in
`server/src/integrations/store.js`). For Microsoft 365 the live Graph calls
are additionally stubbed until the mailbox scope is agreed with the client, so
no real mailbox can be touched by accident. Mock mode is reported on every
mail response (`mode: 'mock'`) and on simulated sends (`mode: 'simulated'`).
