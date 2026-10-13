# Data layer — how the real database drops in

The prototype answers questions today without a database. That is deliberate:
the retrieval layer is behind one contract, so wiring the real data source is a
single adapter rather than a rewrite.

## The contract

`server/src/data/repository.js` defines `ProductionRepository`. Seven methods:

| Method | Returns |
| --- | --- |
| `meta()` | dataset metadata (reference date, row counts) |
| `listIssues(filter)` | raw issue rows |
| `countIssues(filter)` | a count |
| `aggregateIssues(filter, dimension)` | `[{ key, count, vehicles, reworkMinutes, removed }]` |
| `vehicleImpact(filter)` | `{ affected, reworked, removed, reworkMinutes }` |
| `listMaintenance(filter)` | Integral Portal tickets |
| `listDowntime(filter)` | MQTT downtime events |
| `dailyTrend(filter)` | `[{ date, count }]` |

Every method takes the same filter object:

```js
{
  from, to,                  // ISO dates, inclusive
  shiftId, lineId, modelId, errorCode, partId,
  costCenter, checkpointId, severity, reworkCategoryId,
  status, vin,
  limit
}
```

Nothing above this contract knows where the data comes from. The agent tools,
the planner, the synthesizer, the routes and the whole UI are written against
these eight method signatures only.

## What exists now

| Adapter | File | Status |
| --- | --- | --- |
| `memory` | `data/adapters/memory.adapter.js` | Active. Seeded synthetic warehouse, 28 days of history, identical on every boot. |
| `postgres` | `data/adapters/postgres.adapter.js` | Stub. Each method carries the SQL it needs to run as a comment; `buildWhere()` already turns a filter into a parameterised `WHERE` clause. |

Selected in one place, `server/src/data/index.js`, from `JERVIS_DATA_SOURCE`.

## Integrating the database

1. Create the schema: `psql "$DATABASE_URL" -f db/schema.sql`.
2. `npm --workspace server install pg`.
3. In `postgres.adapter.js`, construct the pool in the constructor and replace
   each `notImplemented(...)` with the query already written above it. The
   column names in `db/schema.sql` are the snake_case form of the fields the
   contract returns, so the mapping is mechanical.
4. Run `JERVIS_DATA_SOURCE=postgres DATABASE_URL=... npm run dev:server`.
5. `npm --workspace server test` — the agent tests assert against whatever
   adapter is active, so they double as the integration check.

## Fronting Databricks instead

Databricks is the client's warehouse and hosts the existing chatbot
application, so the likely production shape is Databricks as the system of
record rather than Postgres:

- Add `data/adapters/databricks.adapter.js` implementing the same contract on
  top of `@databricks/sql`, pointed at a SQL warehouse with read-only scopes.
- Keep `aggregateIssues` as a `GROUP BY` pushed into the warehouse — never pull
  rows back to aggregate in Node.
- Register it in `data/index.js` under `JERVIS_DATA_SOURCE=databricks`.

A serving layer in front of Databricks (materialised views, or a cached
Postgres mirror for the dimensions that are queried on every question) is worth
measuring once real query latency is known. The contract supports either
without a code change above the adapter.

## Conversations and audit

Two stores are still in memory and belong in the database at the same time:

- `data/conversations.js` — turn history and the carried context that makes
  follow-up questions work. Schema: `audit.sessions`, `audit.turns`.
- `security/audit.js` — one row per question: role, systems read, redactions.
  Schema: `audit.query_log`.

Both are already shaped as inserts; neither has in-memory-only behaviour that
would resist persistence.
