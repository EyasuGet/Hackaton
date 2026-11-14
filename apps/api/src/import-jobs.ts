// Command-line entry point: import approved career opportunities.
// Usage: pnpm jobs:import [file.json ...] (default: every file in fixtures/jobs)
// All files are validated before any is imported, so one malformed file stops
// the run without changing stored content.
import { readdir, readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDatabaseConfig, loadOrExit } from './bootstrap/config.ts';
import { createPool } from './infrastructure/database/connection.ts';
import {
  ImportJobs,
  InvalidJobError,
  JobVersionConflictError,
} from './modules/careers/application/import-jobs.ts';
import { parseJobFile } from './modules/careers/domain/job.ts';
import { PostgresJobRepository } from './modules/careers/infrastructure/postgres-job-repository.ts';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURES = join(REPOSITORY_ROOT, 'fixtures/jobs');

// Relative paths are resolved from the repository root.
async function inputFiles(args: readonly string[]): Promise<string[]> {
  if (args.length > 0) {
    return args.map((arg) => (isAbsolute(arg) ? arg : resolve(REPOSITORY_ROOT, arg)));
  }
  const names = (await readdir(FIXTURES)).filter((name) => name.endsWith('.json')).sort();
  return names.map((name) => join(FIXTURES, name));
}

const database = loadOrExit(() => loadDatabaseConfig(process.env));
const files = await inputFiles(process.argv.slice(2));

const inputs: { file: string; json: unknown }[] = [];
let invalid = false;

for (const file of files) {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    console.error(
      `${file}: cannot read JSON (${error instanceof Error ? error.message : 'unknown error'})`,
    );
    invalid = true;
    continue;
  }
  const parsed = parseJobFile(json);
  if (!parsed.ok) {
    for (const problem of parsed.errors) console.error(`${file}: ${problem}`);
    invalid = true;
  }
  inputs.push({ file, json });
}

if (invalid) {
  console.error('No jobs were imported.');
  process.exit(1);
}

const pool = createPool(database, () => {});
const importJobs = new ImportJobs(new PostgresJobRepository(pool));

try {
  for (const { file, json } of inputs) {
    try {
      const outcomes = await importJobs.execute(json);
      for (const outcome of outcomes) {
        const pub = outcome.isNewPublication ? ` [new publication: ${outcome.publicationId}]` : '';
        console.log(
          `${file}: ${outcome.id} -> ${outcome.status} (version ${outcome.version})${pub}`,
        );
      }
    } catch (error) {
      if (!(error instanceof JobVersionConflictError || error instanceof InvalidJobError)) {
        throw error;
      }
      console.error(`${file}: ${error.message}`);
      process.exitCode = 1;
    }
  }
} finally {
  await pool.end();
}
