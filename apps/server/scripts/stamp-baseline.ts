import path from 'path';
import { fileURLToPath } from 'url';

import { stampBaseline } from '../src/infra/db/stamp-baseline';

const throughIdx = process.argv.indexOf('--through');
if (throughIdx === -1 || !process.argv[throughIdx + 1]) {
  console.error('Usage: npx tsx scripts/stamp-baseline.ts --through <migration-tag>');
  process.exit(2);
}

const drizzleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle');

stampBaseline(process.argv[throughIdx + 1], drizzleDir).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
