-- Proof of Concept: Gemini Web Browser as external worker

CREATE TABLE IF NOT EXISTS gemini_poc_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  transcript_id UUID NOT NULL REFERENCES transcripts(id),
  status TEXT NOT NULL CHECK (status IN ('queued', 'claimed', 'completed', 'retry_wait', 'failed_terminal')),
  worker_id TEXT,
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  retry_at TIMESTAMPTZ,
  last_error_code TEXT,
  raw_response TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (call_id, transcript_id)
);

CREATE TABLE IF NOT EXISTS gemini_poc_workers (
  worker_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('active', 'idle', 'error')),
  current_job_id UUID REFERENCES gemini_poc_jobs(id),
  jobs_completed INTEGER NOT NULL DEFAULT 0,
  jobs_failed INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gemini_poc_jobs_claim_idx ON gemini_poc_jobs (status, retry_at, updated_at);
