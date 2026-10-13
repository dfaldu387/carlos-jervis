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
| Start a Power Automate flow | `automate:run` (manager-only until the permission is added to the roles) | HTTP trigger of an approved flow (simulated in mock mode) | **`confirm: true` required**, otherwise `400 confirmation_required`; the agent can only propose a flow |

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
(docs/SECRETARY-API.md, "Microsoft 365 live mode") run only once the
connector is configured and enabled, so no real mailbox can be touched by
accident; a Graph failure is surfaced as an error, never replaced by mock
data. Mock mode is reported on every mail response (`mode: 'mock'`) and on
simulated sends and flow triggers (`mode: 'simulated'`). Power Automate's
inbound endpoint answers with a fixed engineer-level service identity
(`userId: 'power-automate'`, `via: 'automate'`), authenticated by a shared
secret rather than a session.

## SSO (Entra ID)

Single sign-on is implemented in `server/src/auth/sso.js` and mounted by
`server/src/routes/auth.js`. It is **off unless configured**: with no
`JERVIS_SSO_*` values the three endpoints answer `enabled: false` / `404` and
nothing else changes. The local demo accounts (`*@jervis.local`, seeded in
`server/src/auth/users.js`) exist for development and demos only; they unlock
synthetic data on a local prototype and must not be the sign-in path of any
deployment. Once Entra ID is wired up, real users sign in through it and the
demo seed can be dropped.

### Endpoints

| Method and path             | Who   | What                                                                 |
| --------------------------- | ----- | -------------------------------------------------------------------- |
| `GET /api/auth/sso`         | public| `{ enabled, provider, loginPath, label }` for the sign-in screen      |
| `GET /api/auth/sso/login`   | public| starts the flow, `302` to Entra (optional `?next=/path`, same-origin) |
| `GET /api/auth/sso/callback`| public| finishes the flow, opens a session, `302` to `next` or `/`           |

### Flow

1. **Login** mints a random `state`, a `nonce` and a PKCE verifier (S256
   challenge), seals them with AES-256-GCM under a key derived from
   `JERVIS_SSO_CLIENT_SECRET` into a 10-minute `httpOnly`, `SameSite=Lax`
   cookie (`jervis_sso`, path `/api/auth/sso`), and redirects to the tenant's
   authorization endpoint with `response_type=code`, `response_mode=query`,
   `scope=openid profile email`. Endpoints come from
   `https://login.microsoftonline.com/<tenant>/v2.0/.well-known/openid-configuration`,
   fetched once and cached with the JWKS resolver.
2. **Callback** checks the returned `state` against the sealed cookie (and
   clears it, so a code cannot be replayed), exchanges the code at the token
   endpoint with the client secret and the PKCE verifier, and verifies the
   `id_token` with `jose` against the tenant JWKS: signature, issuer,
   audience (`client_id`), expiry and `nonce`.
3. The verified claims are then policed: `JERVIS_SSO_ALLOWED_DOMAINS` (if set)
   must contain the email domain; `groups` / `roles` are mapped to a role (see
   below); the user is upserted under `entra_<oid>` with `authSource: 'entra'`
   and no password; a normal server-side session is created and the same
   session cookie as password login is set. `GET /api/auth/me` reports
   `authSource: 'entra'` (local accounts report `'local'`).
4. Any failure is a `302` to `/?sso_error=<code>` with a short code only
   (`state`, `provider`, `code`, `token`, `nonce`, `claims`, `domain`,
   `discovery`); token contents are never written to the response or the log.

The browser reaches the API through the UI's proxy (Vite on 5180, nginx on 80),
so the redirect URI (`JERVIS_SSO_REDIRECT_URI`) is the **public UI origin plus
`/api/auth/sso/callback`**, not the API port, and the post-login redirect is a
relative path so it resolves on whichever origin served the callback. The
exact same URI must be registered on the Entra app registration.

### Role mapping

`JERVIS_SSO_ROLE_MAP` is a JSON object from Entra **group object ids** (the
`groups` claim) or **app role values** (the `roles` claim) to a Jervis role:

```json
{ "6f2c…-managers-group": "manager", "Jervis.Engineer": "engineer", "Jervis.Viewer": "viewer" }
```

A user whose claims match several entries gets the most privileged role
(manager > engineer > viewer). No match falls back to
`JERVIS_SSO_DEFAULT_ROLE` (default `viewer`). The role is recomputed on every
sign-in, so a group change in Entra takes effect at the next login. Everything
downstream (`resolveAccess`, routes, tools, redaction, audit) is unchanged:
it only sees the role on the session.

### Audit

`auth.sso.login` (outcome `ok`) on every SSO sign-in and `auth.sso.denied`
(outcome `denied`, `detail` = the reason) on every refused callback, next to
the existing `auth.login` / `auth.logout` events.

### Configuration

All variables are documented with comments in `server/.env.example`:
`JERVIS_SSO_PROVIDER`, `JERVIS_SSO_TENANT_ID`, `JERVIS_SSO_CLIENT_ID`,
`JERVIS_SSO_CLIENT_SECRET`, `JERVIS_SSO_REDIRECT_URI`, `JERVIS_SSO_ROLE_MAP`,
`JERVIS_SSO_DEFAULT_ROLE`, `JERVIS_SSO_ALLOWED_DOMAINS`. SSO is on only when
the provider is `entra` and tenant id, client id and client secret are all set
(`ssoEnabled()` in `server/src/config.js`). Tests in `server/test/sso.test.js`
exercise the whole flow with an injected token exchange and never contact
Microsoft.
