#!/usr/bin/env node
// Project status board + STATE.md generator + consistency gate.
// Borrowed from digital-qa's scripts/task-next.mjs / check-plan-status.mjs,
// scaled down to fit this repo's Superpowers integration.
//
// Usage:
//   node scripts/state.mjs           # print the board
//   node scripts/state.mjs --write   # regenerate the AUTO block in docs/STATE.md
//   node scripts/state.mjs --check   # exit 1 on close-out debt / stale state (gate)

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plansDir = path.join(root, "docs", "superpowers", "plans");
const stateFile = path.join(root, "docs", "STATE.md");
const integrationBranches = ["dev", "main"]; // merge targets, in priority order

const AUTO_BEGIN = "<!-- AUTO:status BEGIN — regen: node scripts/state.mjs --write -->";
const AUTO_END = "<!-- AUTO:status END -->";

function git(args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null; // missing ref / not a repo / git absent — caller treats as "no fact"
  }
}

// --- plan parsing -------------------------------------------------------------

function parsePlans() {
  if (!existsSync(plansDir)) return [];
  return readdirSync(plansDir)
    .filter((f) => f.endsWith(".md") && !f.startsWith("_")) // _* = fixtures/scratch
    .sort()
    .map((file) => {
      const text = readFileSync(path.join(plansDir, file), "utf8");
      const statusMatch = text.match(/^- Status:\s*(.+)$/m);
      let status = "planned"; // missing Status line or unfilled template => planned
      if (statusMatch && !statusMatch[1].includes("|")) status = statusMatch[1].trim().toLowerCase();
      const branchMatch = text.match(/^- Branch:\s*(.+)$/m);
      const branch = branchMatch && !branchMatch[1].includes("|") ? branchMatch[1].trim() : null;
      const titleMatch = text.match(/^#\s+(.+)$/m);
      return { file, title: titleMatch ? titleMatch[1] : file.replace(/\.md$/, ""), status, branch };
    });
}

// --- git facts ------------------------------------------------------------------

function branchExists(branch) {
  const local = git(["branch", "--list", branch]);
  if (local) return true;
  const remote = git(["branch", "-r", "--list", `origin/${branch}`]);
  return Boolean(remote);
}

// A branch is "merged" if git reports it reachable from an integration branch,
// or its name shows up in a merge commit on an integration branch (covers the
// case where the branch ref was already deleted after merge).
function branchMergedInto(branch) {
  for (const base of integrationBranches) {
    if (!git(["rev-parse", "--verify", "--quiet", base])) continue;
    // zero commits on the branch that the base doesn't have => merged
    const behind = git(["rev-list", "--count", `${base}..${branch}`]);
    if (behind === "0") return base;
    if (git(["log", base, "--oneline", "--merges", `--grep=${branch}`])) return base;
  }
  return null;
}

function branchLastCommitDate(branch) {
  const out = git(["log", "-1", "--format=%cs", branch]);
  return out || null;
}

function planMergedInto(plan) {
  if (!plan.branch) return null;
  // work done directly on an integration branch carries no derivable merge fact
  if (integrationBranches.includes(plan.branch)) return null;
  if (branchExists(plan.branch)) return branchMergedInto(plan.branch);
  // branch ref gone — look for the branch name in merge commits (post-merge deletion)
  for (const base of integrationBranches) {
    if (!git(["rev-parse", "--verify", base])) continue;
    const mergeHit = git(["log", base, "--oneline", "--merges", `--grep=${plan.branch}`]);
    if (mergeHit && mergeHit.includes(plan.branch)) return base;
  }
  return null;
}

// --- derived board ----------------------------------------------------------------

function buildBoard(plans) {
  const board = { inProgress: [], planned: [], done: [], debt: [], stale: [], unknown: [] };
  for (const plan of plans) {
    const mergedInto = planMergedInto(plan);
    switch (plan.status) {
      case "planned":
        board.planned.push(plan);
        break;
      case "in progress":
        if (mergedInto) board.debt.push({ ...plan, mergedInto });
        else if (plan.branch && !branchExists(plan.branch)) board.stale.push(plan);
        else board.inProgress.push({ ...plan, mergedInto, lastCommit: plan.branch ? branchLastCommitDate(plan.branch) : null });
        break;
      case "done":
        board.done.push({ ...plan, branchStillAround: plan.branch ? branchExists(plan.branch) : false });
        break;
      default:
        board.unknown.push(plan);
    }
  }
  return board;
}

// --- rendering --------------------------------------------------------------------

function today() {
  return new Date().toISOString().slice(0, 10);
}

function renderAutoBlock(board) {
  const lines = [];
  const none = "— none —";
  lines.push(`_Generated ${today()} from docs/superpowers/plans/ + git. Never hand-edit; regen with \`node scripts/state.mjs --write\`._`, "");
  lines.push("**In progress**");
  lines.push(...(board.inProgress.length
    ? board.inProgress.map((p) => `- \`${p.file}\` — ${p.title}${p.branch ? ` (branch: \`${p.branch}\`${p.lastCommit ? `, last commit ${p.lastCommit}` : ""})` : " (direct on integration branch)"}`)
    : [none]), "");
  lines.push("**Planned**");
  lines.push(...(board.planned.length ? board.planned.map((p) => `- \`${p.file}\` — ${p.title}`) : [none]), "");
  lines.push("**Done**");
  lines.push(...(board.done.length ? board.done.map((p) => `- \`${p.file}\` — ${p.title}`) : [none]), "");
  lines.push("**Close-out debt (merged but plan not done)**");
  lines.push(...(board.debt.length ? board.debt.map((p) => `- \`${p.file}\` — merged into \`${p.mergedInto}\``) : [none]), "");
  if (board.stale.length || board.unknown.length) {
    lines.push("**Warnings**");
    for (const p of board.stale) lines.push(`- \`${p.file}\` — Status: in progress but branch \`${p.branch}\` no longer exists`);
    for (const p of board.unknown) lines.push(`- \`${p.file}\` — unrecognized Status: \`${p.status}\``);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

function printBoard(board) {
  console.log(`Project state — ${today()} (repo: ${root})`);
  const section = (label, rows) => {
    console.log(`\n${label}`);
    if (!rows.length) return console.log("  (none)");
    for (const row of rows) console.log(`  ${row}`);
  };
  section("IN PROGRESS", board.inProgress.map((p) =>
    `${p.file} — ${p.title}${p.branch ? ` [${p.branch}${p.lastCommit ? ` @${p.lastCommit}` : ""}]` : " [direct]"}`));
  section("CLOSE-OUT DEBT (merged, plan not done)", board.debt.map((p) => `${p.file} — merged into ${p.mergedInto}`));
  section("STALE", board.stale.map((p) => `${p.file} — branch ${p.branch} gone`));
  section("PLANNED (next candidates)", board.planned.map((p) => `${p.file} — ${p.title}`));
  section("DONE", board.done.map((p) => `${p.file}${p.branchStillAround ? " (branch still around)" : ""}`));
  if (board.unknown.length) section("UNRECOGNIZED STATUS", board.unknown.map((p) => `${p.file} — ${p.status}`));
}

// --- STATE.md AUTO block ----------------------------------------------------------

// The "_Generated <date>_" line is cosmetic; strip it so --check compares the
// board content only (otherwise every UTC-midnight rollover reads as "stale").
function stripGeneratedLine(text) {
  return text
    .split("\n")
    .filter((line) => !line.startsWith("_Generated "))
    .join("\n")
    .trim();
}

function currentAutoBlock() {
  if (!existsSync(stateFile)) return null;
  const text = readFileSync(stateFile, "utf8");
  const begin = text.indexOf(AUTO_BEGIN);
  const end = text.indexOf(AUTO_END);
  if (begin < 0 || end < 0 || end < begin) return null;
  return stripGeneratedLine(text.slice(begin + AUTO_BEGIN.length, end));
}

function writeAutoBlock(rendered) {
  if (!existsSync(stateFile)) {
    console.error(`error: ${stateFile} not found — create it with the AUTO markers first`);
    process.exit(1);
  }
  const text = readFileSync(stateFile, "utf8");
  const begin = text.indexOf(AUTO_BEGIN);
  const end = text.indexOf(AUTO_END);
  if (begin < 0 || end < 0 || end < begin) {
    console.error(`error: AUTO markers missing in ${stateFile}`);
    process.exit(1);
  }
  const updated = `${text.slice(0, begin + AUTO_BEGIN.length)}\n${rendered}\n${text.slice(end)}`;
  writeFileSync(stateFile, updated);
  console.log(`AUTO block updated in ${path.relative(root, stateFile)}`);
}

// --- modes --------------------------------------------------------------------------

const mode = process.argv[2] ?? "";
const plans = parsePlans();
const board = buildBoard(plans);

if (mode === "--write") {
  writeAutoBlock(renderAutoBlock(board));
} else if (mode === "--check") {
  const failures = [];
  for (const p of board.debt) {
    failures.push(`close-out debt: ${p.file} merged into ${p.mergedInto} but Status is "${p.status}" (set done + tick boxes + regen before merge)`);
  }
  for (const p of board.stale) {
    failures.push(`stale: ${p.file} is "in progress" but branch ${p.branch} does not exist and no merge records it`);
  }
  const onDisk = currentAutoBlock();
  if (onDisk === null) failures.push(`docs/STATE.md is missing the AUTO:status markers (or the file)`);
  else if (onDisk !== stripGeneratedLine(renderAutoBlock(board))) failures.push("docs/STATE.md AUTO block is stale — run `node scripts/state.mjs --write`");
  if (failures.length) {
    console.error(`state check: ${failures.length} problem(s)`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("state check: OK");
} else {
  printBoard(board);
}
