-- WILP Admissions QA Portal — production schema (Postgres, via Netlify Database)
-- Ported from the original SQLite schema. Dates/timestamps are stored as TEXT (ISO 8601)
-- rather than native TIMESTAMP so the frontend's existing string-based date handling
-- (fmtDate/fmtDateTime, string comparisons for range filters) needs no changes.

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN','QA_ANALYST','TEAM_LEAD','COUNSELOR','LEADERSHIP')),
  counselor_id INTEGER,
  team TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TEXT NOT NULL
);

CREATE TABLE counselors (
  id SERIAL PRIMARY KEY,
  employee_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  team TEXT NOT NULL,
  team_lead_user_id INTEGER REFERENCES users(id),
  joining_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at TEXT NOT NULL
);

ALTER TABLE users ADD CONSTRAINT fk_users_counselor FOREIGN KEY (counselor_id) REFERENCES counselors(id);

CREATE TABLE programmes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE'))
);

CREATE TABLE calls (
  id SERIAL PRIMARY KEY,
  counselor_id INTEGER NOT NULL REFERENCES counselors(id),
  programme_id INTEGER NOT NULL REFERENCES programmes(id),
  call_date TEXT NOT NULL,
  call_type TEXT NOT NULL,
  applicant_stage TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL,
  applicant_name TEXT NOT NULL,
  applicant_phone TEXT,
  disposition TEXT,
  recording_disclosed BOOLEAN NOT NULL DEFAULT FALSE,
  has_recording BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE scorecard_categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  max_points DOUBLE PRECISION NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE scorecard_parameters (
  id SERIAL PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES scorecard_categories(id),
  name TEXT NOT NULL,
  description TEXT,
  weight DOUBLE PRECISION NOT NULL,
  error_severity TEXT NOT NULL CHECK (error_severity IN ('MINOR','MAJOR')),
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE ztp_rules (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  definition TEXT NOT NULL,
  trigger_text TEXT,
  example_text TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE kpi_definitions (
  id SERIAL PRIMARY KEY,
  kpi_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  definition TEXT,
  formula TEXT,
  unit TEXT NOT NULL DEFAULT '',
  target_operator TEXT NOT NULL CHECK (target_operator IN ('>=','<=')),
  target_value DOUBLE PRECISION NOT NULL,
  amber_threshold DOUBLE PRECISION NOT NULL,
  frequency TEXT,
  owner TEXT
);

CREATE TABLE audits (
  id SERIAL PRIMARY KEY,
  call_id INTEGER NOT NULL REFERENCES calls(id),
  counselor_id INTEGER NOT NULL REFERENCES counselors(id),
  auditor_user_id INTEGER NOT NULL REFERENCES users(id),
  audit_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED')),
  overall_score DOUBLE PRECISION,
  max_possible_score DOUBLE PRECISION,
  compliance_score DOUBLE PRECISION,
  ztp_flag BOOLEAN NOT NULL DEFAULT FALSE,
  ztp_rule_id INTEGER REFERENCES ztp_rules(id),
  coaching_priority TEXT,
  final_result TEXT,
  qa_comments TEXT,
  submitted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE audit_scores (
  id SERIAL PRIMARY KEY,
  audit_id INTEGER NOT NULL REFERENCES audits(id),
  parameter_id INTEGER NOT NULL REFERENCES scorecard_parameters(id),
  score_percent DOUBLE PRECISION NOT NULL,
  weighted_score DOUBLE PRECISION NOT NULL,
  evidence TEXT,
  aoi TEXT,
  UNIQUE (audit_id, parameter_id)
);

CREATE TABLE audit_history (
  id SERIAL PRIMARY KEY,
  audit_id INTEGER NOT NULL REFERENCES audits(id),
  action TEXT NOT NULL,
  field TEXT,
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE error_records (
  id SERIAL PRIMARY KEY,
  audit_id INTEGER NOT NULL REFERENCES audits(id),
  counselor_id INTEGER NOT NULL REFERENCES counselors(id),
  parameter_id INTEGER REFERENCES scorecard_parameters(id),
  ztp_rule_id INTEGER REFERENCES ztp_rules(id),
  severity TEXT NOT NULL CHECK (severity IN ('MINOR','MAJOR','FATAL')),
  root_cause_category TEXT,
  is_repeat BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TEXT NOT NULL
);

CREATE TABLE calibration_records (
  id SERIAL PRIMARY KEY,
  call_id INTEGER NOT NULL REFERENCES calls(id),
  auditor_user_id INTEGER NOT NULL REFERENCES users(id),
  auditor_score DOUBLE PRECISION NOT NULL,
  reviewer_user_id INTEGER NOT NULL REFERENCES users(id),
  reviewer_score DOUBLE PRECISION NOT NULL,
  variance DOUBLE PRECISION NOT NULL,
  final_agreed_score DOUBLE PRECISION,
  bias_flag BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RESOLVED')),
  created_at TEXT NOT NULL
);

CREATE TABLE disputes (
  id SERIAL PRIMARY KEY,
  audit_id INTEGER NOT NULL REFERENCES audits(id),
  parameter_id INTEGER NOT NULL REFERENCES scorecard_parameters(id),
  counselor_id INTEGER NOT NULL REFERENCES counselors(id),
  raised_by_user_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  evidence TEXT,
  raised_at TEXT NOT NULL,
  sla_due_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','UPHELD','REVISED')),
  reviewed_by_user_id INTEGER REFERENCES users(id),
  decision_notes TEXT,
  original_score DOUBLE PRECISION,
  revised_score DOUBLE PRECISION,
  closed_at TEXT
);

CREATE TABLE coaching_actions (
  id SERIAL PRIMARY KEY,
  audit_id INTEGER REFERENCES audits(id),
  counselor_id INTEGER NOT NULL REFERENCES counselors(id),
  error_summary TEXT NOT NULL,
  root_cause TEXT,
  coaching_type TEXT NOT NULL,
  action TEXT NOT NULL,
  owner_user_id INTEGER NOT NULL REFERENCES users(id),
  due_date TEXT,
  completion_date TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  before_score DOUBLE PRECISION,
  after_score DOUBLE PRECISION,
  verified_improvement BOOLEAN NOT NULL DEFAULT FALSE,
  effectiveness TEXT,
  comments TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE governance_events (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  cadence TEXT NOT NULL,
  description TEXT,
  owner_user_id INTEGER REFERENCES users(id),
  due_date TEXT NOT NULL,
  completed_date TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','OVERDUE','DONE')),
  linked_type TEXT,
  linked_id INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE login_attempts (
  email TEXT PRIMARY KEY,
  failed_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE config_change_log (
  id SERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id SERIAL PRIMARY KEY,
  jti TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX idx_audits_counselor ON audits(counselor_id);
CREATE INDEX idx_audits_call ON audits(call_id);
CREATE INDEX idx_audit_scores_audit ON audit_scores(audit_id);
CREATE INDEX idx_audit_history_audit ON audit_history(audit_id);
CREATE INDEX idx_error_records_counselor ON error_records(counselor_id);
CREATE INDEX idx_error_records_parameter ON error_records(parameter_id);
CREATE INDEX idx_disputes_counselor ON disputes(counselor_id);
CREATE INDEX idx_disputes_status ON disputes(status);
CREATE INDEX idx_coaching_counselor ON coaching_actions(counselor_id);
CREATE INDEX idx_calls_counselor ON calls(counselor_id);
CREATE INDEX idx_sessions_jti ON sessions(jti);
