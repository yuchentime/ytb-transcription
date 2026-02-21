CREATE TABLE IF NOT EXISTS task_segments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  stage_name TEXT NOT NULL,
  segment_index INTEGER NOT NULL,
  source_text TEXT,
  target_text TEXT,
  status TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  started_at TEXT,
  ended_at TEXT,
  duration_ms INTEGER,
  FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_recovery_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  stage_name TEXT NOT NULL,
  checkpoint_key TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_segments_task_stage
  ON task_segments(task_id, stage_name, segment_index);
CREATE INDEX IF NOT EXISTS idx_task_segments_task_status
  ON task_segments(task_id, status, stage_name);
CREATE INDEX IF NOT EXISTS idx_task_recovery_task
  ON task_recovery_snapshots(task_id, created_at DESC);
