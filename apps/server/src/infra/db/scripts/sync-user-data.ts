/**
 * Interactive user data sync between environments (local ↔ dev ↔ prod).
 *
 * Transfers workout sessions + conversation history for a specific user,
 * identified by Telegram ID in each environment. Skips records already present
 * in the target (idempotent — safe to run multiple times).
 *
 * Configure environments in sync.config.ts before running.
 *
 * Run: npm run db:sync
 *
 * For dev/prod: open SSH tunnel first:
 *   ssh -L 5433:localhost:5432 filko.dev -N &
 */

import * as readline from 'readline';
import { spawn, type ChildProcess } from 'child_process';
import * as net from 'net';

import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq, inArray } from 'drizzle-orm';
import { Pool } from 'pg';

import * as schema from '@infra/db/schema';

import { type EnvConfig, type EnvName, syncConfig } from './sync.config';

// ─── Terminal UI ──────────────────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  white: '\x1b[37m',
};

function print(msg: string) {
  process.stdout.write(msg + '\n');
}

function header(msg: string) {
  print(`\n${c.bold}${c.cyan}${msg}${c.reset}`);
}

function info(label: string, value: string) {
  print(`  ${c.dim}${label}:${c.reset} ${value}`);
}

function success(msg: string) {
  print(`  ${c.green}✓${c.reset} ${msg}`);
}

function warn(msg: string) {
  print(`  ${c.yellow}⚠${c.reset}  ${msg}`);
}

function noop(msg: string) {
  print(`  ${c.dim}–${c.reset} ${msg}`);
}

function separator() {
  print(`${c.dim}${'─'.repeat(60)}${c.reset}`);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, resolve));
}

async function askChoice<T extends string>(
  prompt: string,
  choices: { key: string; label: string; value: T }[],
): Promise<T> {
  print(`\n${c.bold}${prompt}${c.reset}`);
  for (const ch of choices) {
    print(`  ${c.cyan}[${ch.key}]${c.reset} ${ch.label}`);
  }

  while (true) {
    const answer = (await ask(`\n  Your choice: `)).trim().toLowerCase();
    const match = choices.find(ch => ch.key.toLowerCase() === answer);
    if (match) return match.value;
    warn(`Invalid choice "${answer}". Try again.`);
  }
}

async function confirm(prompt: string): Promise<boolean> {
  const answer = (await ask(`\n  ${c.bold}${prompt}${c.reset} ${c.dim}[y/N]${c.reset} `)).trim().toLowerCase();
  return answer === 'y' || answer === 'yes';
}

// ─── SSH Tunnel ───────────────────────────────────────────────────────────────

function isPortOpen(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function resolveContainerIp(sshHost: string, containerName: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'ssh',
      [
        '-o',
        'StrictHostKeyChecking=no',
        sshHost,
        `docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${containerName}`,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let out = '';
    proc.stdout?.on('data', (d: Buffer) => {
      out += d.toString();
    });
    proc.on('close', code => {
      const ip = out.trim();
      if (code !== 0 || !ip) {
        reject(new Error(`Cannot resolve IP for container "${containerName}" on ${sshHost}`));
      } else {
        resolve(ip);
      }
    });
  });
}

async function openTunnel(cfg: NonNullable<EnvConfig['ssh']>): Promise<ChildProcess | null> {
  // Check if port is already open (manually opened tunnel)
  const alreadyOpen = await isPortOpen(cfg.localPort);
  if (alreadyOpen) {
    success(`SSH tunnel already active on localhost:${cfg.localPort}`);
    return null;
  }

  // Resolve container IP dynamically — never hardcode
  print(`  Resolving ${cfg.containerName} on ${cfg.host}…`);
  const containerIp = await resolveContainerIp(cfg.host, cfg.containerName);
  success(`Container IP: ${containerIp}`);

  print(`  Opening SSH tunnel → localhost:${cfg.localPort}…`);

  const proc = spawn(
    'ssh',
    [
      '-N',
      '-L',
      `${cfg.localPort}:${containerIp}:${cfg.remotePort}`,
      '-o',
      'StrictHostKeyChecking=no',
      '-o',
      'ExitOnForwardFailure=yes',
      '-o',
      'ServerAliveInterval=10',
      '-o',
      'ServerAliveCountMax=3',
      cfg.host,
    ],
    { stdio: 'ignore', detached: false },
  );

  // Register immediately so signal handlers can kill it if we die before it opens.
  // No detached — child process is tied to this Node process and dies with it.
  activeTunnels.push(proc);

  proc.on('exit', code => {
    const idx = activeTunnels.indexOf(proc);
    if (idx !== -1) activeTunnels.splice(idx, 1);
    if (code !== null && code !== 0) {
      warn(`SSH tunnel exited unexpectedly (code ${code})`);
    }
  });

  // Wait up to 5s for port to become available
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await isPortOpen(cfg.localPort)) {
      success(`SSH tunnel open on localhost:${cfg.localPort}`);
      return proc;
    }
  }

  proc.kill();
  throw new Error(`SSH tunnel to ${cfg.host} failed to open on localhost:${cfg.localPort}`);
}

// ─── DB ───────────────────────────────────────────────────────────────────────

function makeDb(url: string) {
  const pool = new Pool({ connectionString: url });
  return { db: drizzle(pool, { schema }), pool };
}

async function resolveUser(
  db: ReturnType<typeof drizzle>,
  telegramId: string,
  envLabel: string,
): Promise<string | null> {
  const [account] = await db
    .select({ userId: schema.userAccounts.userId })
    .from(schema.userAccounts)
    .where(and(eq(schema.userAccounts.provider, 'telegram'), eq(schema.userAccounts.providerUserId, telegramId)));

  return account?.userId ?? null;
}

// ─── Preview builders ─────────────────────────────────────────────────────────

interface ConversationPreview {
  sourceTotal: number;
  toInsert: (typeof schema.conversationTurns.$inferSelect)[];
  alreadySynced: number;
}

async function buildConversationPreview(
  srcDb: ReturnType<typeof drizzle>,
  tgtDb: ReturnType<typeof drizzle>,
  sourceUserId: string,
  targetUserId: string,
): Promise<ConversationPreview> {
  const sourceTurns = await srcDb
    .select()
    .from(schema.conversationTurns)
    .where(eq(schema.conversationTurns.userId, sourceUserId))
    .orderBy(schema.conversationTurns.createdAt);

  const existingIds = await tgtDb
    .select({ id: schema.conversationTurns.id })
    .from(schema.conversationTurns)
    .where(eq(schema.conversationTurns.userId, targetUserId));

  const existingIdSet = new Set(existingIds.map(r => r.id));
  const toInsert = sourceTurns.filter(t => !existingIdSet.has(t.id));

  return {
    sourceTotal: sourceTurns.length,
    toInsert,
    alreadySynced: sourceTurns.length - toInsert.length,
  };
}

interface SessionExerciseDetail {
  sessionExercise: typeof schema.sessionExercises.$inferSelect;
  exerciseName: string;
  sets: (typeof schema.sessionSets.$inferSelect)[];
}

interface SessionDetail {
  session: typeof schema.workoutSessions.$inferSelect & { planId: string | null };
  exercises: SessionExerciseDetail[];
}

interface SessionsPreview {
  sourceTotal: number;
  sessionsToInsert: (typeof schema.workoutSessions.$inferSelect & { planId: string | null })[];
  alreadySynced: number;
  exerciseCount: number;
  setCount: number;
  sourceExercises: (typeof schema.sessionExercises.$inferSelect)[];
  sourceSets: (typeof schema.sessionSets.$inferSelect)[];
  sessionDetails: SessionDetail[];
}

async function buildSessionsPreview(
  srcDb: ReturnType<typeof drizzle>,
  tgtDb: ReturnType<typeof drizzle>,
  sourceUserId: string,
  targetUserId: string,
): Promise<SessionsPreview> {
  const sourceSessions = await srcDb
    .select()
    .from(schema.workoutSessions)
    .where(eq(schema.workoutSessions.userId, sourceUserId))
    .orderBy(schema.workoutSessions.createdAt);

  const existingSessionIds = await tgtDb
    .select({ id: schema.workoutSessions.id })
    .from(schema.workoutSessions)
    .where(eq(schema.workoutSessions.userId, targetUserId));

  const existingSessionIdSet = new Set(existingSessionIds.map(r => r.id));

  const allPlanIds = [...new Set(sourceSessions.map(s => s.planId).filter(Boolean))] as string[];
  let presentPlanIds = new Set<string>();

  if (allPlanIds.length > 0) {
    const targetPlans = await tgtDb
      .select({ id: schema.workoutPlans.id })
      .from(schema.workoutPlans)
      .where(inArray(schema.workoutPlans.id, allPlanIds));
    presentPlanIds = new Set(targetPlans.map(p => p.id));
  }

  const sessionsToInsert = sourceSessions
    .filter(s => !existingSessionIdSet.has(s.id))
    .map(s => ({
      ...s,
      userId: targetUserId,
      planId: s.planId && presentPlanIds.has(s.planId) ? s.planId : null,
    }));

  let sourceExercises: (typeof schema.sessionExercises.$inferSelect)[] = [];
  let sourceSets: (typeof schema.sessionSets.$inferSelect)[] = [];

  if (sessionsToInsert.length > 0) {
    const sessionIds = sessionsToInsert.map(s => s.id);
    sourceExercises = await srcDb
      .select()
      .from(schema.sessionExercises)
      .where(inArray(schema.sessionExercises.sessionId, sessionIds));

    if (sourceExercises.length > 0) {
      sourceSets = await srcDb
        .select()
        .from(schema.sessionSets)
        .where(
          inArray(
            schema.sessionSets.sessionExerciseId,
            sourceExercises.map(e => e.id),
          ),
        );
    }
  }

  // Fetch exercise names for preview
  const exerciseIds = [...new Set(sourceExercises.map(e => e.exerciseId))];
  const exerciseNames = new Map<number, string>();
  if (exerciseIds.length > 0) {
    const rows = await srcDb
      .select({ id: schema.exercises.id, name: schema.exercises.name })
      .from(schema.exercises)
      .where(inArray(schema.exercises.id, exerciseIds));
    for (const r of rows) exerciseNames.set(r.id, r.name);
  }

  // Build per-session detail structure for preview display
  const setsByExercise = new Map<string, (typeof schema.sessionSets.$inferSelect)[]>();
  for (const s of sourceSets) {
    const arr = setsByExercise.get(s.sessionExerciseId) ?? [];
    arr.push(s);
    setsByExercise.set(s.sessionExerciseId, arr);
  }

  const exercisesBySession = new Map<string, (typeof schema.sessionExercises.$inferSelect)[]>();
  for (const e of sourceExercises) {
    const arr = exercisesBySession.get(e.sessionId) ?? [];
    arr.push(e);
    exercisesBySession.set(e.sessionId, arr);
  }

  const sessionDetails: SessionDetail[] = sessionsToInsert.map(s => ({
    session: s,
    exercises: (exercisesBySession.get(s.id) ?? [])
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map(se => ({
        sessionExercise: se,
        exerciseName: exerciseNames.get(se.exerciseId) ?? `exercise#${se.exerciseId}`,
        sets: (setsByExercise.get(se.id) ?? []).sort((a, b) => a.setNumber - b.setNumber),
      })),
  }));

  return {
    sourceTotal: sourceSessions.length,
    sessionsToInsert,
    alreadySynced: sourceSessions.length - sessionsToInsert.length,
    exerciseCount: sourceExercises.length,
    setCount: sourceSets.length,
    sourceExercises,
    sourceSets,
    sessionDetails,
  };
}

// ─── Display preview ──────────────────────────────────────────────────────────

function displayConversationPreview(preview: ConversationPreview) {
  header('Conversation history preview');

  if (preview.toInsert.length === 0) {
    noop(`All ${preview.sourceTotal} turns already synced — nothing to transfer`);
    return;
  }

  info('Total in source', String(preview.sourceTotal));
  info('Already in target', `${c.dim}${preview.alreadySynced}${c.reset} ${c.dim}(will skip)${c.reset}`);
  info('Will transfer', `${c.green}${preview.toInsert.length} turns${c.reset}`);

  // Show first and last turn date
  const first = preview.toInsert[0];
  const last = preview.toInsert[preview.toInsert.length - 1];
  if (first && last) {
    info('Date range', `${fmt(first.createdAt)} → ${fmt(last.createdAt)}`);
  }

  // Group by phase
  const byPhase = new Map<string, number>();
  for (const t of preview.toInsert) {
    byPhase.set(t.phase, (byPhase.get(t.phase) ?? 0) + 1);
  }
  info('By phase', [...byPhase.entries()].map(([p, n]) => `${p}:${c.green}${n}${c.reset}`).join('  '));
}

function displaySessionsPreview(preview: SessionsPreview) {
  header('Workout sessions preview');

  if (preview.sessionsToInsert.length === 0) {
    noop(`All ${preview.sourceTotal} sessions already synced — nothing to transfer`);
    return;
  }

  info('Total in source', String(preview.sourceTotal));
  info('Already in target', `${c.dim}${preview.alreadySynced}${c.reset} ${c.dim}(will skip)${c.reset}`);
  info(
    'Will transfer',
    `${c.green}${preview.sessionsToInsert.length} sessions, ${preview.exerciseCount} exercises, ${preview.setCount} sets${c.reset}`,
  );

  for (const { session: s, exercises } of preview.sessionDetails) {
    const statusColor = s.status === 'completed' ? c.green : s.status === 'in_progress' ? c.yellow : c.dim;
    print('');
    print(
      `  ${c.bold}${fmt(s.startedAt)}${c.reset}  ` +
        `${statusColor}${s.status}${c.reset}  ` +
        `${c.dim}${s.durationMinutes ? `${s.durationMinutes} min` : '—'}${c.reset}`,
    );

    if (exercises.length === 0) {
      print(`    ${c.dim}(no exercises recorded)${c.reset}`);
    }

    for (const { exerciseName, sets } of exercises) {
      // Compact sets: "10×40 9×40 8×40"
      const setsStr = sets
        .map(st => {
          const d = st.setData as Record<string, unknown>;
          if (d['type'] === 'isometric') {
            const sec = d['durationSeconds'] ?? d['duration'];
            return sec ? `${sec}s` : '?s';
          }
          if (d['type'] === 'cardio_distance') {
            const dist = d['distance'] != null ? `${d['distance']}${d['distanceUnit'] ?? 'km'}` : null;
            const dur =
              d['duration'] != null
                ? Number(d['duration']) > 0
                  ? `${Math.round(Number(d['duration']) / 60)}min`
                  : '?min'
                : null;
            const incline = d['inclinePct'] != null ? `${d['inclinePct']}%` : null;
            return [dist, dur, incline].filter(Boolean).join(' ');
          }
          if (d['type'] === 'cardio_duration') {
            const dur = d['duration'] != null ? `${Math.round(Number(d['duration']) / 60)}min` : '?min';
            return dur;
          }
          const reps = d['reps'] ?? '?';
          const weight = d['weight'];
          return weight && Number(weight) > 0 ? `${reps}×${weight}` : `${reps}`;
        })
        .join('  ');

      print(`    ${c.cyan}•${c.reset} ${exerciseName.padEnd(32)} ` + `${c.dim}${setsStr || '—'}${c.reset}`);
    }
  }
}

function fmt(date: Date | null | undefined): string {
  if (!date) return 'N/A';
  return date.toISOString().replace('T', ' ').slice(0, 16);
}

// ─── Execute sync ─────────────────────────────────────────────────────────────

async function executeConversationSync(
  tgtDb: ReturnType<typeof drizzle>,
  preview: ConversationPreview,
  targetUserId: string,
): Promise<void> {
  if (preview.toInsert.length === 0) return;
  const rows = preview.toInsert.map(t => ({ ...t, userId: targetUserId }));
  await tgtDb.insert(schema.conversationTurns).values(rows);
  success(`Inserted ${rows.length} conversation turns`);
}

async function executeSessionsSync(tgtDb: ReturnType<typeof drizzle>, preview: SessionsPreview): Promise<void> {
  if (preview.sessionsToInsert.length === 0) return;

  await tgtDb.insert(schema.workoutSessions).values(preview.sessionsToInsert);
  success(`Inserted ${preview.sessionsToInsert.length} workout sessions`);

  if (preview.sourceExercises.length > 0) {
    await tgtDb.insert(schema.sessionExercises).values(preview.sourceExercises);
    success(`Inserted ${preview.sourceExercises.length} session exercises`);
  }

  if (preview.sourceSets.length > 0) {
    await tgtDb.insert(schema.sessionSets).values(preview.sourceSets);
    success(`Inserted ${preview.sourceSets.length} session sets`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  print(`\n${c.bold}${c.magenta}╔══════════════════════════════════════╗${c.reset}`);
  print(`${c.bold}${c.magenta}║      FitCoach Data Sync Wizard       ║${c.reset}`);
  print(`${c.bold}${c.magenta}╚══════════════════════════════════════╝${c.reset}`);

  const envNames = Object.keys(syncConfig) as EnvName[];

  // ── Step 1: choose direction ───────────────────────────────────────────────
  const sourceEnv = await askChoice<EnvName>(
    'Select SOURCE environment (copy FROM):',
    envNames.map((k, i) => ({ key: String(i + 1), label: syncConfig[k].label, value: k })),
  );

  const targetChoices = envNames.filter(k => k !== sourceEnv);
  const targetEnv = await askChoice<EnvName>(
    'Select TARGET environment (copy TO):',
    targetChoices.map((k, i) => ({ key: String(i + 1), label: syncConfig[k].label, value: k })),
  );

  const srcCfg: EnvConfig = syncConfig[sourceEnv];
  const tgtCfg: EnvConfig = syncConfig[targetEnv];

  separator();
  print(`  ${c.bold}Direction:${c.reset} ${c.cyan}${srcCfg.label}${c.reset} → ${c.green}${tgtCfg.label}${c.reset}`);

  // ── Step 2: choose what to sync ────────────────────────────────────────────
  const syncWhat = await askChoice<'all' | 'sessions' | 'conversation'>('What to sync?', [
    { key: '1', label: 'Everything (sessions + conversation)', value: 'all' },
    { key: '2', label: 'Workout sessions only', value: 'sessions' },
    { key: '3', label: 'Conversation history only', value: 'conversation' },
  ]);

  const doSessions = syncWhat === 'all' || syncWhat === 'sessions';
  const doConversation = syncWhat === 'all' || syncWhat === 'conversation';

  // ── Step 3: open tunnels + connect ────────────────────────────────────────
  header('Connecting to databases…');

  let srcConn: ReturnType<typeof makeDb>;
  let tgtConn: ReturnType<typeof makeDb>;
  const tunnels: ChildProcess[] = [];

  try {
    if (srcCfg.ssh) {
      const t = await openTunnel(srcCfg.ssh);
      if (t) tunnels.push(t);
    }
    if (tgtCfg.ssh) {
      const t = await openTunnel(tgtCfg.ssh);
      if (t) tunnels.push(t);
    }

    srcConn = makeDb(srcCfg.dbUrl);
    tgtConn = makeDb(tgtCfg.dbUrl);
    await srcConn.pool.query('SELECT 1');
    success(`Connected to ${srcCfg.label}`);
    await tgtConn.pool.query('SELECT 1');
    success(`Connected to ${tgtCfg.label}`);
  } catch (err) {
    tunnels.forEach(t => t.kill());
    const msg = err instanceof Error ? err.message : String(err);
    print(`\n  ${c.red}✗ Connection failed: ${msg}${c.reset}`);
    process.exit(1);
  }

  const sourceUserId = await resolveUser(srcConn.db, srcCfg.telegramId, srcCfg.label);
  if (!sourceUserId) {
    print(`\n  ${c.red}✗ No user found in ${srcCfg.label} for Telegram ID: ${srcCfg.telegramId}${c.reset}`);
    print(`  ${c.dim}Check sync.config.ts — telegramId must match user_accounts.provider_user_id${c.reset}`);
    await cleanup(srcConn, tgtConn, tunnels);
    process.exit(1);
  }
  success(`Source user resolved: ${c.dim}${sourceUserId.slice(0, 8)}…${c.reset}`);

  const targetUserId = await resolveUser(tgtConn.db, tgtCfg.telegramId, tgtCfg.label);
  if (!targetUserId) {
    print(`\n  ${c.red}✗ No user found in ${tgtCfg.label} for Telegram ID: ${tgtCfg.telegramId}${c.reset}`);
    print(`  ${c.dim}Check sync.config.ts — user must be registered in the target env (start the bot once)${c.reset}`);
    await cleanup(srcConn, tgtConn, tunnels);
    process.exit(1);
  }
  success(`Target user resolved: ${c.dim}${targetUserId.slice(0, 8)}…${c.reset}`);

  // ── Step 4: build and display preview ─────────────────────────────────────
  header('Analyzing differences…');

  let convPreview: ConversationPreview | null = null;
  let sessPreview: SessionsPreview | null = null;

  if (doConversation) {
    convPreview = await buildConversationPreview(srcConn.db, tgtConn.db, sourceUserId, targetUserId);
    displayConversationPreview(convPreview);
  }

  if (doSessions) {
    sessPreview = await buildSessionsPreview(srcConn.db, tgtConn.db, sourceUserId, targetUserId);
    displaySessionsPreview(sessPreview);
  }

  // ── Step 5: check if there's anything to do ────────────────────────────────
  const nothingToDo =
    (convPreview === null || convPreview.toInsert.length === 0) &&
    (sessPreview === null || sessPreview.sessionsToInsert.length === 0);

  if (nothingToDo) {
    print('');
    separator();
    print(`\n  ${c.green}${c.bold}Everything is already in sync. Nothing to transfer.${c.reset}\n`);
    await cleanup(srcConn, tgtConn, tunnels);
    return;
  }

  // ── Step 6: confirm ────────────────────────────────────────────────────────
  separator();
  const ok = await confirm(`Proceed with sync to ${c.green}${tgtCfg.label}${c.reset}?`);

  if (!ok) {
    print(`\n  ${c.yellow}Aborted.${c.reset}\n`);
    await cleanup(srcConn, tgtConn, tunnels);
    return;
  }

  // ── Step 7: execute ────────────────────────────────────────────────────────
  header('Syncing…');

  if (convPreview) await executeConversationSync(tgtConn.db, convPreview, targetUserId);
  if (sessPreview) await executeSessionsSync(tgtConn.db, sessPreview);

  print('');
  separator();
  print(`\n  ${c.bold}${c.green}Sync complete.${c.reset}\n`);

  await cleanup(srcConn, tgtConn, tunnels);
}

async function cleanup(
  srcConn: ReturnType<typeof makeDb>,
  tgtConn: ReturnType<typeof makeDb>,
  tunnels: ChildProcess[] = [],
): Promise<void> {
  rl.close();
  await srcConn.pool.end();
  await tgtConn.pool.end();
  tunnels.forEach(t => t.kill());
}

// Track all tunnels globally so signal handlers can clean them up
const activeTunnels: ChildProcess[] = [];

function killTunnels() {
  for (const t of activeTunnels) {
    try {
      t.kill();
    } catch {}
  }
  activeTunnels.length = 0;
}

process.on('exit', killTunnels);
process.on('SIGINT', () => {
  killTunnels();
  process.exit(130);
});
process.on('SIGTERM', () => {
  killTunnels();
  process.exit(143);
});
process.on('uncaughtException', err => {
  print(`\n  ${c.red}✗ Unexpected error: ${err.message}${c.reset}\n`);
  killTunnels();
  process.exit(1);
});

run().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  print(`\n  ${c.red}✗ Unexpected error: ${msg}${c.reset}\n`);
  killTunnels();
  process.exit(1);
});
