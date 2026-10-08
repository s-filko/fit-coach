/**
 * Migration 0024 (plan-and-tool-fixes T7, AC-PTF-7): `exercises.weight_mode` — the per-exercise
 * weight contract (required / optional / none) with its check, and the backfill that maps the
 * standing catalog shapes onto the three modes. Everything runs inside one transaction and is
 * ROLLED BACK, like the migration-0010 test; the shared test schema is left as setup built it.
 */
import { readFile } from 'fs/promises';
import path from 'path';

import { Pool, type PoolClient } from 'pg';

import { deriveWeightMode } from '@domain/training/weight-mode';
import type { Exercise } from '@domain/training/types';

const MIGRATION_FILE = 'drizzle/0024_flawless_felicia_hardy.sql';

/** The exercise rows a pre-migration catalog holds, one per shape the backfill must tell apart. */
const PRE_MIGRATION_ROWS: Array<{
  key: string;
  name: string;
  category: Exercise['category'];
  equipment: Exercise['equipment'];
  exerciseType: Exercise['exerciseType'];
}> = [
  // The Gravitron: machine equipment — `required`; "Assisted …" in the name says what the number means.
  {
    key: 'gravitron',
    name: 'Assisted Pull-ups (Gravitron)',
    category: 'compound',
    equipment: 'machine',
    exerciseType: 'strength',
  },
  {
    key: 'bench',
    name: 'Back Squat',
    category: 'compound',
    equipment: 'barbell',
    exerciseType: 'strength',
  },
  {
    key: 'dumbbell',
    name: 'Dumbbell Curl',
    category: 'isolation',
    equipment: 'dumbbell',
    exerciseType: 'strength',
  },
  {
    key: 'pull-ups',
    name: 'Weighted Pull-up',
    category: 'compound',
    equipment: 'bodyweight',
    exerciseType: 'strength',
  },
  {
    key: 'running',
    name: 'Trail Running',
    category: 'cardio',
    equipment: 'none',
    exerciseType: 'cardio_distance',
  },
  // Machine cardio (treadmill, rowing): category cardio wins over the machine equipment.
  {
    key: 'treadmill',
    name: 'Treadmill',
    category: 'cardio',
    equipment: 'machine',
    exerciseType: 'cardio_distance',
  },
  // A reps-only machine movement (the ab machine): optional — used without added load.
  {
    key: 'ab-machine',
    name: 'Ab Coaster',
    category: 'functional',
    equipment: 'machine',
    exerciseType: 'functional_reps',
  },
  {
    key: 'plank',
    name: 'Plank',
    category: 'functional',
    equipment: 'bodyweight',
    exerciseType: 'isometric',
  },
  {
    key: 'jump-rope',
    name: 'Jump Rope',
    category: 'functional',
    equipment: 'none',
    exerciseType: 'interval',
  },
];

describe('migration 0024 — exercises.weight_mode (AC-PTF-7)', () => {
  let pool: Pool;
  let client: PoolClient;
  let backfillStatements: string[];

  beforeAll(async () => {
    pool = new Pool({
      host: process.env.DB_HOST!,
      user: process.env.DB_USER!,
      password: process.env.DB_PASSWORD!,
      database: process.env.DB_NAME!,
      port: Number(process.env.DB_PORT),
    });
    const migrationSql = await readFile(path.resolve(process.cwd(), MIGRATION_FILE), 'utf8');
    backfillStatements = migrationSql
      .split('--> statement-breakpoint')
      // A chunk may open with prose comments — the statement is what follows them.
      .map(s => s.replace(/^--.*/gm, '').trim())
      .filter(s => s.startsWith('UPDATE "exercises"'));
  });

  beforeEach(async () => {
    client = await pool.connect();
    await client.query('BEGIN');
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
    client.release();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('the column is NOT NULL defaulting to required, and the check constraint exists', async () => {
    const column = await client.query<{ is_nullable: string; column_default: string }>(
      `SELECT is_nullable, column_default FROM information_schema.columns
       WHERE table_name = 'exercises' AND column_name = 'weight_mode'`,
    );
    expect(column.rows).toHaveLength(1);
    expect(column.rows[0]!.is_nullable).toBe('NO');
    expect(column.rows[0]!.column_default).toContain('required');

    const constraint = await client.query(
      "SELECT 1 FROM pg_constraint WHERE conname = 'exercises_weight_mode_check' AND conrelid = 'exercises'::regclass",
    );
    expect(constraint.rows).toHaveLength(1);

    await expect(client.query("UPDATE exercises SET weight_mode = 'sometimes'")).rejects.toThrow();
  });

  it('the backfill maps every catalog shape to its mode — the Gravitron required, Pull-ups optional, cardio/none none (AC-PTF-7)', async () => {
    expect(backfillStatements).toHaveLength(3);

    // The scenario suites seed a catalog row with the Gravitron's name (shared test DB); the probe rows below
    // reuse the names, so clear them inside this rolled-back transaction first.
    await client.query('DELETE FROM exercises WHERE name = ANY($1)', [PRE_MIGRATION_ROWS.map(r => r.name)]);

    for (const [i, row] of PRE_MIGRATION_ROWS.entries()) {
      // The state right after ADD COLUMN ... DEFAULT 'required': every existing row carries required.
      await client.query(
        `INSERT INTO exercises (id, name, category, equipment, exercise_type, description,
           energy_cost, complexity, typical_duration_minutes, weight_mode)
         VALUES ($1, $2, $3, $4, $5, 'backfill probe', 'medium', 'beginner', 10, 'required')`,
        [
          `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          row.name,
          row.category,
          row.equipment,
          row.exerciseType,
        ],
      );
    }

    for (const statement of backfillStatements) {
      await client.query(statement);
    }

    const { rows } = await client.query<{ name: string; weight_mode: string }>(
      "SELECT name, weight_mode FROM exercises WHERE description = 'backfill probe'",
    );
    const byName = new Map(rows.map(r => [r.name, r.weight_mode]));
    for (const row of PRE_MIGRATION_ROWS) {
      // One rule in code (deriveWeightMode, applied by the seed) and one in SQL (this migration).
      expect(byName.get(row.name)).toBe(deriveWeightMode(row.category, row.equipment, row.exerciseType));
    }
    // Anchors, so a derivation that drifted in both places still fails: the Gravitron is required,
    // Pull-ups-like and the ab machine optional, cardio none.
    expect(byName.get('Assisted Pull-ups (Gravitron)')).toBe('required');
    expect(byName.get('Weighted Pull-up')).toBe('optional');
    expect(byName.get('Ab Coaster')).toBe('optional');
    expect(byName.get('Trail Running')).toBe('none');
  });

  it('the seeded test catalog carries the modes the suites rely on (AC-PTF-7)', async () => {
    const { rows } = await client.query<{ name: string; weight_mode: string }>(
      `SELECT name, weight_mode FROM exercises WHERE name IN
         ('Barbell Bench Press', 'Barbell Back Squat', 'Pull-ups', 'Running')`,
    );
    const byName = new Map(rows.map(r => [r.name, r.weight_mode]));
    expect(byName.get('Barbell Bench Press')).toBe('required');
    expect(byName.get('Barbell Back Squat')).toBe('required');
    expect(byName.get('Pull-ups')).toBe('optional');
    expect(byName.get('Running')).toBe('none');
  });
});
