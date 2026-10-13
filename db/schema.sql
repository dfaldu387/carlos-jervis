-- ---------------------------------------------------------------------------
-- Jervis - production data schema
--
-- Target shape for the database integration. The prototype answers from the
-- in-memory synthetic warehouse; these tables are what the Postgres adapter in
-- server/src/data/adapters/postgres.adapter.js expects. Column names match the
-- fields the repository contract returns, so the adapter is a thin mapping.
--
-- In a Databricks-fronted deployment the same columns become the serving views
-- over prod_quality.* - the repository contract does not care which engine
-- answers, only that these fields come back.
-- ---------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS production;
CREATE SCHEMA IF NOT EXISTS maintenance;
CREATE SCHEMA IF NOT EXISTS telemetry;
CREATE SCHEMA IF NOT EXISTS audit;

-- ---- reference data -------------------------------------------------------

CREATE TABLE IF NOT EXISTS production.lines (
  line_id      text PRIMARY KEY,
  name         text NOT NULL,
  area         text NOT NULL,
  cost_center  text NOT NULL
);

CREATE TABLE IF NOT EXISTS production.shifts (
  shift_id   text PRIMARY KEY,         -- S1 / S2 / S3
  name       text NOT NULL,
  start_hour smallint NOT NULL,        -- 6 / 14 / 22
  end_hour   smallint NOT NULL         -- 14 / 22 / 6
);

CREATE TABLE IF NOT EXISTS production.models (
  model_id text PRIMARY KEY,
  name     text NOT NULL
);

CREATE TABLE IF NOT EXISTS production.cost_centers (
  cost_center text PRIMARY KEY,
  name        text NOT NULL,
  area        text NOT NULL
);

CREATE TABLE IF NOT EXISTS production.checkpoints (
  checkpoint_id text PRIMARY KEY,
  name          text NOT NULL,
  line_id       text REFERENCES production.lines (line_id)
);

CREATE TABLE IF NOT EXISTS production.parts (
  part_id     text PRIMARY KEY,
  name        text NOT NULL,
  supplier    text,                    -- withheld from roles without supplier:read
  cost_center text REFERENCES production.cost_centers (cost_center)
);

CREATE TABLE IF NOT EXISTS production.error_codes (
  error_code  text PRIMARY KEY,
  description text NOT NULL,
  category    text NOT NULL,
  symptom     text
);

CREATE TABLE IF NOT EXISTS production.rework_categories (
  rework_category_id text PRIMARY KEY,
  name               text NOT NULL,
  removes_vehicle    boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS production.vehicles (
  vin       text PRIMARY KEY,
  model_id  text REFERENCES production.models (model_id),
  line_id   text REFERENCES production.lines (line_id),
  built_on  date NOT NULL
);

-- ---- fact table -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS production.issue_events (
  issue_id           text PRIMARY KEY,
  issue_date         date NOT NULL,
  detected_at        timestamptz NOT NULL,
  shift_id           text NOT NULL REFERENCES production.shifts (shift_id),
  line_id            text NOT NULL REFERENCES production.lines (line_id),
  model_id           text REFERENCES production.models (model_id),
  vin                text REFERENCES production.vehicles (vin),
  error_code         text NOT NULL REFERENCES production.error_codes (error_code),
  part_id            text REFERENCES production.parts (part_id),
  cost_center        text REFERENCES production.cost_centers (cost_center),
  checkpoint_id      text REFERENCES production.checkpoints (checkpoint_id),
  severity           text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  rework_category_id text REFERENCES production.rework_categories (rework_category_id),
  vehicle_removed    boolean NOT NULL DEFAULT false,
  rework_minutes     integer NOT NULL DEFAULT 0,
  status             text NOT NULL CHECK (status IN ('open', 'in_progress', 'resolved')),
  source             text NOT NULL DEFAULT 'databricks',
  source_table       text
);

-- Every repository filter combination is a prefix of one of these.
CREATE INDEX IF NOT EXISTS issue_events_date_idx ON production.issue_events (issue_date);
CREATE INDEX IF NOT EXISTS issue_events_date_shift_line_idx
  ON production.issue_events (issue_date, shift_id, line_id);
CREATE INDEX IF NOT EXISTS issue_events_error_code_idx ON production.issue_events (error_code);
CREATE INDEX IF NOT EXISTS issue_events_model_idx ON production.issue_events (model_id);
CREATE INDEX IF NOT EXISTS issue_events_vin_idx ON production.issue_events (vin);

-- ---- maintenance (Integral Portal) ---------------------------------------

CREATE TABLE IF NOT EXISTS maintenance.assets (
  asset_id text PRIMARY KEY,
  name     text NOT NULL,
  line_id  text REFERENCES production.lines (line_id)
);

CREATE TABLE IF NOT EXISTS maintenance.tickets (
  ticket_id   text PRIMARY KEY,
  ticket_date date NOT NULL,
  shift_id    text REFERENCES production.shifts (shift_id),
  asset_id    text REFERENCES maintenance.assets (asset_id),
  line_id     text REFERENCES production.lines (line_id),
  opened_at   timestamptz NOT NULL,
  closed_at   timestamptz,
  status      text NOT NULL CHECK (status IN ('open', 'closed')),
  priority    text NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
  description text,
  technician  text,
  source      text NOT NULL DEFAULT 'integral_portal'
);

CREATE INDEX IF NOT EXISTS tickets_date_idx ON maintenance.tickets (ticket_date);

-- ---- telemetry (MQTT) -----------------------------------------------------

CREATE TABLE IF NOT EXISTS telemetry.downtime_events (
  event_id         text PRIMARY KEY,
  event_date       date NOT NULL,
  shift_id         text REFERENCES production.shifts (shift_id),
  line_id          text REFERENCES production.lines (line_id),
  asset_id         text REFERENCES maintenance.assets (asset_id),
  topic            text NOT NULL,
  started_at       timestamptz NOT NULL,
  duration_minutes integer NOT NULL,
  reason           text,
  source           text NOT NULL DEFAULT 'mqtt'
);

CREATE INDEX IF NOT EXISTS downtime_date_idx ON telemetry.downtime_events (event_date);

-- ---- conversations and audit ---------------------------------------------

CREATE TABLE IF NOT EXISTS audit.sessions (
  session_id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id    text,
  role       text
);

CREATE TABLE IF NOT EXISTS audit.turns (
  turn_id    text PRIMARY KEY,
  session_id text REFERENCES audit.sessions (session_id),
  asked_at   timestamptz NOT NULL DEFAULT now(),
  question   text NOT NULL,
  intent     text,
  period_from date,
  period_to   date,
  answer     jsonb NOT NULL,
  elapsed_ms integer
);

-- One row per question: who asked, what was read, what was withheld.
CREATE TABLE IF NOT EXISTS audit.query_log (
  entry_id    text PRIMARY KEY,
  logged_at   timestamptz NOT NULL DEFAULT now(),
  user_id     text,
  role        text NOT NULL,
  question    text NOT NULL,
  intent      text,
  sources     text[] NOT NULL DEFAULT '{}',
  tools_used  text[] NOT NULL DEFAULT '{}',
  redactions  jsonb NOT NULL DEFAULT '[]',
  provider    text,
  elapsed_ms  integer
);

CREATE INDEX IF NOT EXISTS query_log_logged_at_idx ON audit.query_log (logged_at DESC);
