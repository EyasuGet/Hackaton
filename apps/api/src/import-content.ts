// Command-line entry point: import approved lesson source files.
// Usage: pnpm content:import [file.json ...]  (default: every file in fixtures/courses)
// All files are validated before any is imported, so one malformed file stops
// the run without changing stored content.
import { readdir, readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDatabaseConfig, loadOrExit } from './bootstrap/config.ts';
import { createPool } from './infrastructure/database/connection.ts';
import {
  ImportLessonSource,
  InvalidLessonSourceError,
  VersionConflictError,
} from './modules/content/application/import-lesson-source.ts';
import { parseLessonSource } from './modules/content/domain/lesson-source.ts';
import { PostgresLessonRepository } from './modules/content/infrastructure/postgres-lesson-repository.ts';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURES = join(REPOSITORY_ROOT, 'fixtures/courses');

// pnpm runs this from apps/api; relative paths are taken from the repository root.
async function inputFiles(args: readonly string[]): Promise<string[]> {
  if (args.length > 0)
    return args.map((arg) => (isAbsolute(arg) ? arg : resolve(REPOSITORY_ROOT, arg)));
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
  const parsed = parseLessonSource(json);
  if (!parsed.ok) {
    for (const problem of parsed.errors) console.error(`${file}: ${problem}`);
    invalid = true;
  }
  inputs.push({ file, json });
}
if (invalid) {
  console.error('No content was imported.');
  process.exit(1);
}

const pool = createPool(database, () => {});
const importLesson = new ImportLessonSource(new PostgresLessonRepository(pool));
try {
  for (const { file, json } of inputs) {
    try {
      const outcome = await importLesson.execute(json);
      const detail = outcome.status === 'imported' ? `, ${outcome.sections} sections` : '';
      console.log(`${file}: ${outcome.status} (version ${outcome.version}${detail})`);
    } catch (error) {
      if (!(error instanceof VersionConflictError || error instanceof InvalidLessonSourceError))
        throw error;
      console.error(`${file}: ${error.message}`);
      process.exitCode = 1;
    }
  }
} finally {
  await pool.end();
}
