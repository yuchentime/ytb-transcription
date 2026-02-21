import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
const schemaPath = path.join(repoRoot, 'electron', 'core', 'db', 'schema.sql')
const migrationPath = path.join(repoRoot, 'electron', 'core', 'db', 'migrations', '002_add_segment_tables.sql')

const SEGMENTS_PER_STAGE = 1000
const SNAPSHOT_COUNT = 1000
const QUERY_ITERATIONS = 300

function percentile(values, p) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[rank]
}

function summarize(values) {
  if (values.length === 0) {
    return { count: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 }
  }
  const sum = values.reduce((acc, item) => acc + item, 0)
  return {
    count: values.length,
    avgMs: Number((sum / values.length).toFixed(3)),
    p50Ms: Number(percentile(values, 50).toFixed(3)),
    p95Ms: Number(percentile(values, 95).toFixed(3)),
    maxMs: Number(Math.max(...values).toFixed(3)),
  }
}

function timeOne(fn) {
  const started = process.hrtime.bigint()
  fn()
  const elapsedNs = process.hrtime.bigint() - started
  return Number(elapsedNs) / 1e6
}

function setupDatabase({ withIndexes }) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dao2-04-'))
  const dbPath = path.join(tempDir, `${withIndexes ? 'with' : 'without'}-index.db`)
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')

  db.exec(fs.readFileSync(schemaPath, 'utf-8'))
  db.exec(fs.readFileSync(migrationPath, 'utf-8'))

  if (!withIndexes) {
    db.exec(`
      DROP INDEX IF EXISTS idx_task_segments_task_stage;
      DROP INDEX IF EXISTS idx_task_segments_task_status;
      DROP INDEX IF EXISTS idx_task_recovery_task;
    `)
  }

  return { db, dbPath, tempDir }
}

function seedData(db) {
  const now = new Date().toISOString()
  const taskId = randomUUID()

  db.prepare(`
    INSERT INTO tasks(
      id, youtube_url, youtube_title, status, source_language, target_language,
      whisper_model, provider, translate_model_id, tts_model_id, tts_voice,
      model_config_snapshot, error_code, error_message, created_at, updated_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    taskId,
    'https://youtube.com/watch?v=dao2bench',
    'DAO2 benchmark task',
    'failed',
    'en',
    'zh',
    'small',
    'minimax',
    'translation-1',
    'speech-1',
    'female-timeless',
    JSON.stringify({ segmentationStrategy: 'punctuation' }),
    'E_TEST',
    'bench',
    now,
    now,
    now,
  )

  const insertSegment = db.prepare(`
    INSERT INTO task_segments(
      id, task_id, stage_name, segment_index, source_text, target_text, status, retry_count,
      error_code, error_message, started_at, ended_at, duration_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const txInsertSegments = db.transaction(() => {
    for (const stageName of ['translating', 'synthesizing']) {
      for (let i = 0; i < SEGMENTS_PER_STAGE; i += 1) {
        const failed = i % 10 === 0
        const done = !failed && i % 3 === 0
        const status = failed ? 'failed' : done ? 'success' : 'pending'
        insertSegment.run(
          randomUUID(),
          taskId,
          stageName,
          i,
          `[${stageName}] source ${i}`,
          done ? `[${stageName}] target ${i}` : null,
          status,
          failed ? 1 : 0,
          failed ? 'E_TIMEOUT' : null,
          failed ? 'Network timeout' : null,
          now,
          now,
          12,
        )
      }
    }
  })
  txInsertSegments()

  const insertSnapshot = db.prepare(`
    INSERT INTO task_recovery_snapshots(task_id, stage_name, checkpoint_key, snapshot_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `)
  const txInsertSnapshots = db.transaction(() => {
    for (let i = 0; i < SNAPSHOT_COUNT; i += 1) {
      const createdAt = new Date(Date.now() + i).toISOString()
      insertSnapshot.run(
        taskId,
        i % 2 === 0 ? 'translating' : 'synthesizing',
        `bench:${i}`,
        JSON.stringify({
          stageName: i % 2 === 0 ? 'translating' : 'synthesizing',
          checkpointSegmentId: `seg-${i}`,
          failedSegmentIds: [`seg-${i}`],
          configSnapshot: { targetLanguage: 'zh' },
        }),
        createdAt,
      )
    }
  })
  txInsertSnapshots()

  return { taskId }
}

function benchmarkQueries(db, taskId) {
  const sql = {
    listByTaskAndStage: `
      SELECT id, stage_name AS stageName, segment_index AS segmentIndex
      FROM task_segments
      WHERE task_id = ? AND stage_name = ?
      ORDER BY segment_index ASC
    `,
    listFailedSegmentsAll: `
      SELECT id, stage_name AS stageName, segment_index AS segmentIndex
      FROM task_segments
      WHERE task_id = ? AND status = 'failed'
      ORDER BY stage_name ASC, segment_index ASC
    `,
    listFailedSegmentsByStage: `
      SELECT id, stage_name AS stageName, segment_index AS segmentIndex
      FROM task_segments
      WHERE task_id = ? AND stage_name = ? AND status = 'failed'
      ORDER BY segment_index ASC
    `,
    latestSnapshot: `
      SELECT id, stage_name AS stageName, created_at AS createdAt
      FROM task_recovery_snapshots
      WHERE task_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `,
  }

  const stmtListByStage = db.prepare(sql.listByTaskAndStage)
  const stmtFailedAll = db.prepare(sql.listFailedSegmentsAll)
  const stmtFailedByStage = db.prepare(sql.listFailedSegmentsByStage)
  const stmtLatestSnapshot = db.prepare(sql.latestSnapshot)

  const durations = {
    listByTaskAndStage: [],
    listFailedSegmentsAll: [],
    listFailedSegmentsByStage: [],
    latestSnapshot: [],
  }

  for (let i = 0; i < QUERY_ITERATIONS; i += 1) {
    durations.listByTaskAndStage.push(timeOne(() => stmtListByStage.all(taskId, 'translating')))
    durations.listFailedSegmentsAll.push(timeOne(() => stmtFailedAll.all(taskId)))
    durations.listFailedSegmentsByStage.push(timeOne(() => stmtFailedByStage.all(taskId, 'translating')))
    durations.latestSnapshot.push(timeOne(() => stmtLatestSnapshot.get(taskId)))
  }

  const explain = {
    listByTaskAndStage: db
      .prepare(`EXPLAIN QUERY PLAN ${sql.listByTaskAndStage}`)
      .all(taskId, 'translating'),
    listFailedSegmentsAll: db
      .prepare(`EXPLAIN QUERY PLAN ${sql.listFailedSegmentsAll}`)
      .all(taskId),
    listFailedSegmentsByStage: db
      .prepare(`EXPLAIN QUERY PLAN ${sql.listFailedSegmentsByStage}`)
      .all(taskId, 'translating'),
    latestSnapshot: db
      .prepare(`EXPLAIN QUERY PLAN ${sql.latestSnapshot}`)
      .all(taskId),
  }

  return {
    queryLatency: {
      listByTaskAndStage: summarize(durations.listByTaskAndStage),
      listFailedSegmentsAll: summarize(durations.listFailedSegmentsAll),
      listFailedSegmentsByStage: summarize(durations.listFailedSegmentsByStage),
      latestSnapshot: summarize(durations.latestSnapshot),
    },
    explain,
  }
}

function benchmarkWrites(db, taskId) {
  const translatingIds = db.prepare(`
      SELECT id
      FROM task_segments
      WHERE task_id = ? AND stage_name = 'translating'
      ORDER BY segment_index ASC
    `)
    .all(taskId)
    .map((row) => row.id)

  const markRunning = db.prepare(`
      UPDATE task_segments
      SET status = 'running', started_at = ?, ended_at = NULL, duration_ms = NULL, error_code = NULL, error_message = NULL
      WHERE id = ?
    `)
  const markSuccess = db.prepare(`
      UPDATE task_segments
      SET status = 'success', target_text = ?, ended_at = ?, duration_ms = 18
      WHERE id = ?
    `)

  const runningDurations = []
  const successDurations = []
  const batchRoundDurations = []

  for (let round = 0; round < 5; round += 1) {
    const roundMs = timeOne(() => {
      for (const segmentId of translatingIds) {
        runningDurations.push(timeOne(() => markRunning.run(new Date().toISOString(), segmentId)))
        successDurations.push(
          timeOne(() =>
            markSuccess.run(`[translated] ${segmentId.slice(0, 8)}`, new Date().toISOString(), segmentId),
          ),
        )
      }
    })
    batchRoundDurations.push(roundMs)
  }

  return {
    writeLatency: {
      markSegmentRunning: summarize(runningDurations),
      markSegmentSuccess: summarize(successDurations),
      writeRoundFor1000Segments: summarize(batchRoundDurations),
    },
  }
}

function normalizeExplain(planRows) {
  return planRows.map((row) => row.detail).join(' | ')
}

function runCase(withIndexes) {
  const setup = setupDatabase({ withIndexes })
  try {
    const { taskId } = seedData(setup.db)
    const query = benchmarkQueries(setup.db, taskId)
    const write = benchmarkWrites(setup.db, taskId)
    return {
      withIndexes,
      dbPath: setup.dbPath,
      ...query,
      ...write,
      explainSummary: {
        listByTaskAndStage: normalizeExplain(query.explain.listByTaskAndStage),
        listFailedSegmentsAll: normalizeExplain(query.explain.listFailedSegmentsAll),
        listFailedSegmentsByStage: normalizeExplain(query.explain.listFailedSegmentsByStage),
        latestSnapshot: normalizeExplain(query.explain.latestSnapshot),
      },
    }
  } finally {
    setup.db.close()
    fs.rmSync(setup.tempDir, { recursive: true, force: true })
  }
}

function printCaseResult(title, result) {
  console.log(`\n[${title}]`)
  console.log('queryLatency(ms):', JSON.stringify(result.queryLatency, null, 2))
  console.log('writeLatency(ms):', JSON.stringify(result.writeLatency, null, 2))
  console.log('queryPlan:', JSON.stringify(result.explainSummary, null, 2))
}

function main() {
  if (!fs.existsSync(schemaPath) || !fs.existsSync(migrationPath)) {
    throw new Error(`Schema or migration SQL not found.\n- ${schemaPath}\n- ${migrationPath}`)
  }

  console.log(`DAO2-04 benchmark started (segments/stage=${SEGMENTS_PER_STAGE}, snapshots=${SNAPSHOT_COUNT})`)

  const withIndexResult = runCase(true)
  const withoutIndexResult = runCase(false)
  printCaseResult('WITH_INDEXES', withIndexResult)
  printCaseResult('WITHOUT_INDEXES', withoutIndexResult)

  const report = {
    benchmarkAt: new Date().toISOString(),
    nodeVersion: process.version,
    segmentsPerStage: SEGMENTS_PER_STAGE,
    snapshots: SNAPSHOT_COUNT,
    queryIterations: QUERY_ITERATIONS,
    withIndexes: withIndexResult,
    withoutIndexes: withoutIndexResult,
  }

  const reportPath = path.join(repoRoot, 'docs', 'verification', 'dao2-04-benchmark.latest.json')
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(`\nBenchmark report saved: ${reportPath}`)
}

main()
