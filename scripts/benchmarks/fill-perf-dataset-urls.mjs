#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'

function parseArgs(argv) {
  const result = {
    target: '',
    map: '',
    output: '',
    inPlace: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--target') {
      result.target = argv[i + 1] ?? ''
      i += 1
      continue
    }
    if (token === '--map') {
      result.map = argv[i + 1] ?? ''
      i += 1
      continue
    }
    if (token === '--output') {
      result.output = argv[i + 1] ?? ''
      i += 1
      continue
    }
    if (token === '--in-place') {
      result.inPlace = true
      continue
    }
    if (token === '--help' || token === '-h') {
      result.help = true
      return result
    }
    throw new Error(`Unknown arg: ${token}`)
  }

  return result
}

function printHelp() {
  console.log(
    [
      'Usage:',
      '  node scripts/benchmarks/fill-perf-dataset-urls.mjs \\',
      '    --target docs/verification/perf-baseline.baseline-current.json \\',
      '    --map docs/verification/perf-baseline.dataset-urls.template.json \\',
      '    --in-place',
      '',
      'Options:',
      '  --target <file>   Baseline JSON file to update',
      '  --map <file>      Mapping file: { "datasetId": "youtubeUrlOrId" }',
      '  --output <file>   Output file path (optional when not using --in-place)',
      '  --in-place        Overwrite target file directly',
      '  -h, --help        Show this help',
    ].join('\n'),
  )
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJson(filePath) {
  const text = await fs.readFile(filePath, 'utf-8')
  return JSON.parse(text)
}

function assertDatasetShape(doc) {
  if (!isRecord(doc)) {
    throw new Error('Target JSON must be an object')
  }
  if (!Array.isArray(doc.datasets)) {
    throw new Error('Target JSON must include datasets[]')
  }
  for (const dataset of doc.datasets) {
    if (!isRecord(dataset) || typeof dataset.id !== 'string') {
      throw new Error('Each dataset must include string field id')
    }
    if (typeof dataset.urlOrId !== 'string') {
      throw new Error(`Dataset ${dataset.id} must include string field urlOrId`)
    }
  }
}

function normalizeMapping(rawMap) {
  if (!isRecord(rawMap)) {
    throw new Error('Map JSON must be an object: { "datasetId": "urlOrId" }')
  }
  const normalized = new Map()
  for (const [key, value] of Object.entries(rawMap)) {
    if (typeof value !== 'string') {
      throw new Error(`Map value must be string for key: ${key}`)
    }
    const datasetId = key.trim()
    const urlOrId = value.trim()
    if (!datasetId) {
      throw new Error('Map key cannot be empty')
    }
    if (!urlOrId) {
      throw new Error(`Map value cannot be empty for key: ${key}`)
    }
    normalized.set(datasetId, urlOrId)
  }
  return normalized
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }

  if (!args.target || !args.map) {
    printHelp()
    throw new Error('Missing required args: --target and --map')
  }
  if (!args.inPlace && !args.output) {
    throw new Error('Specify --in-place or provide --output <file>')
  }

  const targetPath = path.resolve(process.cwd(), args.target)
  const mapPath = path.resolve(process.cwd(), args.map)
  const doc = await readJson(targetPath)
  const rawMap = await readJson(mapPath)
  assertDatasetShape(doc)
  const mapping = normalizeMapping(rawMap)

  const knownIds = new Set(doc.datasets.map((item) => item.id))
  const unknownMapKeys = [...mapping.keys()].filter((key) => !knownIds.has(key))
  if (unknownMapKeys.length > 0) {
    throw new Error(`Map contains unknown dataset ids: ${unknownMapKeys.join(', ')}`)
  }

  let updated = 0
  let skipped = 0
  const unresolved = []

  const nextDoc = {
    ...doc,
    datasets: doc.datasets.map((dataset) => {
      const mapped = mapping.get(dataset.id)
      if (!mapped) {
        unresolved.push(dataset.id)
        return dataset
      }
      if (mapped.startsWith('TODO_')) {
        skipped += 1
        return dataset
      }
      if (dataset.urlOrId === mapped) {
        return dataset
      }
      updated += 1
      return {
        ...dataset,
        urlOrId: mapped,
      }
    }),
  }

  const outputPath = args.inPlace
    ? targetPath
    : path.resolve(process.cwd(), args.output)
  await fs.writeFile(outputPath, `${JSON.stringify(nextDoc, null, 2)}\n`, 'utf-8')

  console.log(
    [
      'fill-perf-dataset-urls done',
      `target=${targetPath}`,
      `map=${mapPath}`,
      `output=${outputPath}`,
      `updated=${updated}`,
      `skippedTodo=${skipped}`,
      `unresolved=${unresolved.length}`,
    ].join(' | '),
  )
  if (unresolved.length > 0) {
    console.log(`unresolvedDatasetIds=${unresolved.join(',')}`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
