-- Insight Capture Tables
-- Creates tables for access requests and plan builder session tracking

-- Access Requests Table
-- Stores private beta access requests with context
CREATE TABLE IF NOT EXISTS access_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  reason TEXT,  -- communication, scheduling, mediation, court-order, exploring
  notes TEXT,
  page_url TEXT,
  referrer TEXT,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for reviewing requests by date
CREATE INDEX IF NOT EXISTS idx_access_requests_submitted_at
  ON access_requests(submitted_at DESC);

-- Index for finding duplicates by email
CREATE INDEX IF NOT EXISTS idx_access_requests_email
  ON access_requests(email);

-- Plan Builder Sessions Table
-- Tracks step progression without capturing plan content
CREATE TABLE IF NOT EXISTS plan_builder_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT UNIQUE NOT NULL,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  referrer TEXT,
  steps_visited TEXT[],  -- Array of step names
  max_step_index INTEGER,
  max_step_name TEXT,
  completed BOOLEAN DEFAULT FALSE,
  abandoned BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for analyzing completion rates
CREATE INDEX IF NOT EXISTS idx_pb_sessions_completed
  ON plan_builder_sessions(completed, abandoned);

-- Index for analyzing drop-off points
CREATE INDEX IF NOT EXISTS idx_pb_sessions_max_step
  ON plan_builder_sessions(max_step_name);

-- Index for time-based analysis
CREATE INDEX IF NOT EXISTS idx_pb_sessions_started_at
  ON plan_builder_sessions(started_at DESC);


-- ============================================
-- VIEWS FOR EASY DATA REVIEW
-- ============================================

-- Access Requests Summary View
CREATE OR REPLACE VIEW access_requests_summary AS
SELECT
  DATE(submitted_at) as date,
  COUNT(*) as total_requests,
  COUNT(DISTINCT email) as unique_emails,
  COUNT(*) FILTER (WHERE reason IS NOT NULL) as with_reason,
  COUNT(*) FILTER (WHERE notes IS NOT NULL AND notes != '') as with_notes,
  -- Reason breakdown
  COUNT(*) FILTER (WHERE reason = 'communication') as reason_communication,
  COUNT(*) FILTER (WHERE reason = 'scheduling') as reason_scheduling,
  COUNT(*) FILTER (WHERE reason = 'mediation') as reason_mediation,
  COUNT(*) FILTER (WHERE reason = 'court-order') as reason_court_order,
  COUNT(*) FILTER (WHERE reason = 'exploring') as reason_exploring
FROM access_requests
GROUP BY DATE(submitted_at)
ORDER BY date DESC;

-- Plan Builder Funnel View
CREATE OR REPLACE VIEW plan_builder_funnel AS
SELECT
  DATE(started_at) as date,
  COUNT(*) as total_sessions,
  COUNT(*) FILTER (WHERE max_step_index >= 1) as reached_children,
  COUNT(*) FILTER (WHERE max_step_index >= 2) as reached_schedule,
  COUNT(*) FILTER (WHERE max_step_index >= 3) as reached_configure,
  COUNT(*) FILTER (WHERE max_step_index >= 4) as reached_holidays,
  COUNT(*) FILTER (WHERE max_step_index >= 5) as reached_summer,
  COUNT(*) FILTER (WHERE max_step_index >= 6) as reached_review,
  COUNT(*) FILTER (WHERE max_step_index >= 7) as reached_email,
  COUNT(*) FILTER (WHERE completed = true) as completed,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE completed = true) / NULLIF(COUNT(*), 0),
    1
  ) as completion_rate
FROM plan_builder_sessions
GROUP BY DATE(started_at)
ORDER BY date DESC;

-- Drop-off Analysis View
CREATE OR REPLACE VIEW plan_builder_dropoff AS
SELECT
  max_step_name as dropped_at,
  COUNT(*) as sessions,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) as percentage
FROM plan_builder_sessions
WHERE abandoned = true
GROUP BY max_step_name
ORDER BY
  CASE max_step_name
    WHEN 'welcome' THEN 0
    WHEN 'children' THEN 1
    WHEN 'schedule' THEN 2
    WHEN 'configure' THEN 3
    WHEN 'holidays' THEN 4
    WHEN 'summer' THEN 5
    WHEN 'review' THEN 6
    WHEN 'email' THEN 7
    ELSE 99
  END;


-- ============================================
-- ROW LEVEL SECURITY (Optional)
-- ============================================

-- Enable RLS on tables
ALTER TABLE access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_builder_sessions ENABLE ROW LEVEL SECURITY;

-- Allow insert from edge functions (service role)
CREATE POLICY "Service role can insert access_requests"
  ON access_requests FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can insert plan_builder_sessions"
  ON plan_builder_sessions FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Allow service role to read for analysis
CREATE POLICY "Service role can read access_requests"
  ON access_requests FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Service role can read plan_builder_sessions"
  ON plan_builder_sessions FOR SELECT
  TO service_role
  USING (true);
