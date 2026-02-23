CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,
  name TEXT,
  total_count INTEGER NOT NULL,
  accepted_count INTEGER NOT NULL,
  rejected_count INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS batch_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL,
  task_id TEXT,
  youtube_url TEXT NOT NULL,
  status TEXT NOT NULL,
  reject_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(batch_id) REFERENCES batches(id) ON DELETE CASCADE,
  FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS task_queue (
  task_id TEXT PRIMARY KEY,
  batch_id TEXT,
  queue_status TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  queue_index INTEGER NOT NULL,
  enqueued_at TEXT NOT NULL,
  started_at TEXT,
  heartbeat_at TEXT,
  finished_at TEXT,
  worker_slot INTEGER,
  last_error_code TEXT,
  FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY(batch_id) REFERENCES batches(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_batch_items_batch_status
  ON batch_items(batch_id, status);

CREATE INDEX IF NOT EXISTS idx_batch_items_task_id
  ON batch_items(task_id);

CREATE INDEX IF NOT EXISTS idx_task_queue_status_index
  ON task_queue(queue_status, queue_index);

CREATE INDEX IF NOT EXISTS idx_task_queue_batch
  ON task_queue(batch_id, queue_status);
