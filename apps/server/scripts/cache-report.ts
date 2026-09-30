/**
 * Zero-LLM prompt-cache report (prompt-caching plan D8.5): hit rate, read/write/uncached tokens, the cost split
 * and the cache breaks grouped by class and place, sorted by money lost. Read-only, reads `llm_calls`.
 *
 * Run: npm run cache-report -- <userId> <from ISO> <to ISO> [--price <USD per 1M input tokens>] [--ttl 5m|1h]
 *      [--env-file <path>]
 *
 * Every model is priced from its own list price (input, cache multipliers, OUTPUT — src/infra/ai/model-prices.ts,
 * overridable with LLM_MODEL_PRICES); `--price` forces one flat input price on all models (output unpriced). The TTL
 * defaults to LLM_PROMPT_CACHE_TTL. `--env-file` works as in
 * print-transcript: the imports that open a database connection are dynamic, so they resolve only after the
 * override has loaded its file.
 */
import path from 'node:path';

import dotenv from 'dotenv';

function usageError(message: string): never {
  console.error(`${message}\n`);
  console.error(
    'Usage: npm run cache-report -- <userId> <from ISO> <to ISO> [--price <USD/1M>] [--ttl 5m|1h] [--env-file <path>]',
  );
  process.exit(2);
}

function argValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx === -1 ? undefined : args[idx + 1];
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const [userId, fromRaw, toRaw] = args;
  if (!userId || !fromRaw || !toRaw || userId.startsWith('--')) {
    usageError('<userId> <from> <to> are required');
  }
  const from = new Date(fromRaw);
  const to = new Date(toRaw);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    usageError('<from> and <to> must be ISO dates');
  }
  const envFile = argValue(args, '--env-file');
  if (envFile) {
    dotenv.config({ path: path.resolve(process.cwd(), envFile), override: true });
  }

  const [
    { pool },
    { loadConfig },
    { buildCacheReport, formatCacheReport },
    { formatDatabaseTarget, describeSchemaError },
  ] = await Promise.all([
    import('@infra/db/drizzle'),
    import('@config/index'),
    import('@infra/observability/cache-report'),
    import('@infra/observability/db-target'),
  ]);
  const cfg = loadConfig();
  const priceArg = argValue(args, '--price');
  const flatPrice = priceArg === undefined ? undefined : Number(priceArg);
  if (flatPrice !== undefined && (!Number.isFinite(flatPrice) || flatPrice <= 0)) {
    usageError('--price must be a positive number (USD per 1M input tokens)');
  }
  const ttlArg = argValue(args, '--ttl') ?? cfg.LLM_PROMPT_CACHE_TTL;
  if (ttlArg !== '5m' && ttlArg !== '1h') {
    usageError('--ttl must be 5m or 1h');
  }

  const target = {
    host: String(pool.options.host),
    port: Number(pool.options.port),
    database: String(pool.options.database),
  };
  console.log(formatDatabaseTarget(target));
  try {
    const report = await buildCacheReport({
      userId,
      from,
      to,
      inputPricePerMTok: flatPrice,
      prices: parseModelPrices(cfg.LLM_MODEL_PRICES),
      cacheTtl: ttlArg,
    });
    console.log(formatCacheReport(report));
  } catch (err) {
    const friendly = describeSchemaError(err, target);
    if (friendly) {
      console.error(friendly);
      process.exitCode = 1;
      return;
    }
    throw err;
  } finally {
    await pool.end();
  }
}

run().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
