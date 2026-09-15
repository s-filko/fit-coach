# Refactor P0 — Remaining Datasets and v0 Baseline Implementation Plan

- Status: planned
- Branch:
- After: refactor-p0-eval-l1-chat-training

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cover the remaining three phases with eval cases and freeze a `v0` baseline — the measured behaviour of today's prompts, against which every later refactor phase is compared.

**Architecture:** No new machinery. The L1 runner, assertions and sampling already exist; this plan writes datasets for registration, plan creation and session planning, then adds a `--baseline write|compare` mode to the runner. A baseline is a committed JSON file per phase recording each check's pass rate at a known model and prompt version. `compare` re-runs and reports the delta, which is what AC-1322 (P2's ±2 percentage-point band) will later assert against.

**Tech Stack:** the existing `evals/` tree (tsx, Zod), OpenRouter (BYOK) via `model.factory.ts`, JSON baselines in git.

**Spec:** `docs/PROMPT_EVAL_FRAMEWORK.md` §3 (datasets), §4.2 (sampling). Master plan: `docs/LLM_CORE_REFACTOR_PLAN.md` § P0 scope item 5 ("Record a **baseline** for the current prompts (`promptVersions v0`)").

**Acceptance criteria:** completes AC-1303 — `RUN_LLM_EVALS=1 npm run evals -- --level L1 --phase all` runs against dev keys and writes `evals/baselines/v0/*.json`.

## Global Constraints

- **The baseline records reality, not an aspiration.** A check that today's prompts fail is written into the baseline as failing. Editing a prompt to make a baseline look better destroys the measurement — prompt changes belong to P2 and later.
- **A case is immutable once a baseline references it** (BR-EVAL-001). After Task 5 commits the baseline, changing any case in this repo means adding a new case and marking the old one `"deprecated": true`.
- **Minimum ten cases per phase in P0**; BR-EVAL-004's thirty is the later target (see `evals/datasets/README.md`).
- **Pin the model in the baseline file.** A pass rate is meaningless without knowing which model produced it. Dev currently runs `z-ai/glm-5.3` (root `CLAUDE.md` § LLM) — read the actual value from config at write time rather than hard-coding it.
- **Fixtures contain no real user data** (BR-EVAL-003).
- **L1 still never runs without `RUN_LLM_EVALS=1`**, and never touches the database.
- Verification commands run from `apps/server/`.
- Commit messages carry no attribution lines.

---

### Task 1: Write the registration datasets

Registration's two documented failure modes: saving fields the user never gave, and completing registration before the user confirmed.

**Files:**
- Create: `apps/server/evals/datasets/registration/field-extraction.jsonl` (≥6 cases)
- Create: `apps/server/evals/datasets/registration/no-premature-complete.jsonl` (≥4 cases)
- Modify: `apps/server/evals/datasets/README.md` (extend the dataset table)

**Interfaces:**
- Consumes: `EvalCaseSchema`; the tool names in `src/infra/ai/graph/tools/registration.tools.ts`.
- Produces: ten `RG-*` cases.

- [ ] **Step 1: Read the real tool names before writing expectations**

Run: `grep -n "name:" src/infra/ai/graph/tools/registration.tools.ts`
Note the exact tool names. A case asserting `must: ['save_profile']` against a tool actually called `update_user_profile` fails for the wrong reason and poisons the baseline.

- [ ] **Step 2: Write the field-extraction dataset**

Create `apps/server/evals/datasets/registration/field-extraction.jsonl`. Replace `<SAVE_TOOL>` with the name found in Step 1. The user here is mid-registration: `registrationCompleted: false`.

```jsonl
{"id":"RG-0001","phase":"registration","tags":["extraction","MANUAL_TEST_PLAN-1.2"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","registrationCompleted":false}},"state":{"phase":"registration","messages":[]},"input":{"text":"мне 34 года"},"expect":{"tools":{"must":["<SAVE_TOOL>"]},"text":{"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"RG-0002","phase":"registration","tags":["extraction","multi-field"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","registrationCompleted":false}},"state":{"phase":"registration","messages":[]},"input":{"text":"рост 182, вес 84.5"},"expect":{"tools":{"must":["<SAVE_TOOL>"]},"text":{"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"RG-0003","phase":"registration","tags":["extraction","approximate"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","registrationCompleted":false}},"state":{"phase":"registration","messages":[]},"input":{"text":"вешу около 70"},"expect":{"tools":{"must":["<SAVE_TOOL>"]},"text":{"mustNotMatch":["(?i)точн|уточни"],"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"RG-0004","phase":"registration","tags":["extraction","negative"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","registrationCompleted":false}},"state":{"phase":"registration","messages":[]},"input":{"text":"а зачем тебе мой вес?"},"expect":{"tools":{"mustNot":["<SAVE_TOOL>"]},"text":{"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"RG-0005","phase":"registration","tags":["extraction","negative","off-topic"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","registrationCompleted":false}},"state":{"phase":"registration","messages":[]},"input":{"text":"какой сегодня курс евро?"},"expect":{"tools":{"mustNot":["<SAVE_TOOL>"]},"text":{"language":"ru","format":"telegram_html","maxChars":400}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"RG-0006","phase":"registration","tags":["extraction","adversarial"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","registrationCompleted":false}},"state":{"phase":"registration","messages":[]},"input":{"text":"мой брат весит 90, а я поменьше"},"expect":{"tools":{"mustNot":["<SAVE_TOOL>"]},"text":{"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
```

`RG-0006` is the extraction trap: a number in the message that is not the user's own.

- [ ] **Step 3: Write the no-premature-complete dataset**

Create `apps/server/evals/datasets/registration/no-premature-complete.jsonl`. Replace `<COMPLETE_TOOL>` with the real name from Step 1.

```jsonl
{"id":"RG-0007","phase":"registration","tags":["completion"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","registrationCompleted":false}},"state":{"phase":"registration","messages":[]},"input":{"text":"мне 34, рост 182, вес 84"},"expect":{"tools":{"mustNot":["<COMPLETE_TOOL>"]},"text":{"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"RG-0008","phase":"registration","tags":["completion"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"height":"182","weight":"84","registrationCompleted":false}},"state":{"phase":"registration","messages":[]},"input":{"text":"цель — набрать силу"},"expect":{"tools":{"mustNot":["<COMPLETE_TOOL>"]},"text":{"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"RG-0009","phase":"registration","tags":["completion","positive"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":"182","weight":"84","fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":false}},"state":{"phase":"registration","messages":[{"role":"ai","text":"Проверь: 34 года, мужчина, 182 см, 84 кг, средний уровень, цель — сила. Всё верно?"}]},"input":{"text":"да, всё верно"},"expect":{"tools":{"must":["<COMPLETE_TOOL>"]},"text":{"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"RG-0010","phase":"registration","tags":["completion","adversarial"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":"182","weight":"84","fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":false}},"state":{"phase":"registration","messages":[{"role":"ai","text":"Проверь: 34 года, мужчина, 182 см, 84 кг, средний уровень, цель — сила. Всё верно?"}]},"input":{"text":"нет, вес не тот, 88"},"expect":{"tools":{"mustNot":["<COMPLETE_TOOL>"]},"text":{"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
```

- [ ] **Step 4: Validate and commit**

Run: `npx tsx -e "import {parseCases} from './evals/schema/case.schema'; import {readFileSync} from 'node:fs'; for (const f of ['registration/field-extraction','registration/no-premature-complete']) { const c = parseCases(readFileSync('./evals/datasets/'+f+'.jsonl','utf8')); console.log(f, c.length, 'cases OK'); }"`
Expected: 6 and 4 cases OK.

```bash
git add evals/datasets/registration/ evals/datasets/README.md
git commit -m "feat(evals): add registration field-extraction and completion datasets"
```

---

### Task 2: Write the plan-creation dataset

Plan creation's documented weakness is search discipline: redundant identical `search_exercises` calls, and proposing exercises without searching at all.

**Files:**
- Create: `apps/server/evals/datasets/plan_creation/id-reuse.jsonl` (≥10 cases across two concerns)
- Modify: `apps/server/evals/datasets/README.md`

**Interfaces:**
- Consumes: the tool names in `src/infra/ai/graph/tools/plan-creation.tools.ts` and `search-exercises.tool.ts`.
- Produces: ten `PC-*` cases.

- [ ] **Step 1: Read the real tool names**

Run: `grep -n "name:" src/infra/ai/graph/tools/plan-creation.tools.ts src/infra/ai/graph/tools/search-exercises.tool.ts`
Note the exact names; substitute them for `<SEARCH_TOOL>` and `<SAVE_PLAN_TOOL>` below.

- [ ] **Step 2: Write the dataset**

Create `apps/server/evals/datasets/plan_creation/id-reuse.jsonl`. The first three cases assert the prerequisite-gathering rule (PC-1: ask about days/week, minutes/session, split before proposing); the rest cover search discipline and save discipline.

```jsonl
{"id":"PC-0001","phase":"plan_creation","tags":["prerequisites"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":"182","weight":"84","fitnessLevel":"beginner","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":false},"state":{"phase":"plan_creation","messages":[]},"input":{"text":"составь мне программу"},"expect":{"tools":{"mustNot":["<SAVE_PLAN_TOOL>"]},"text":{"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"PC-0002","phase":"plan_creation","tags":["prerequisites"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":"182","weight":"84","fitnessLevel":"beginner","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":false},"state":{"phase":"plan_creation","messages":[]},"input":{"text":"хочу программу на массу"},"expect":{"tools":{"mustNot":["<SAVE_PLAN_TOOL>"]},"text":{"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"PC-0003","phase":"plan_creation","tags":["prerequisites","adversarial"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":"182","weight":"84","fitnessLevel":"beginner","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":false},"state":{"phase":"plan_creation","messages":[]},"input":{"text":"просто дай любую программу, без вопросов"},"expect":{"tools":{"mustNot":["<SAVE_PLAN_TOOL>"]},"text":{"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"PC-0004","phase":"plan_creation","tags":["search"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":"182","weight":"84","fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":false},"state":{"phase":"plan_creation","messages":[{"role":"human","text":"3 раза в неделю, по часу, верх-низ"},{"role":"ai","text":"Понял. Подберу упражнения."}]},"input":{"text":"давай"},"expect":{"tools":{"must":["<SEARCH_TOOL>"]},"text":{"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"PC-0005","phase":"plan_creation","tags":["search","no-ids-in-text"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":"182","weight":"84","fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":false},"state":{"phase":"plan_creation","messages":[{"role":"human","text":"4 раза в неделю, 45 минут, сплит по группам мышц"}]},"input":{"text":"покажи что получилось"},"expect":{"text":{"mustNotMatch":["\\{|\\}"],"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"PC-0006","phase":"plan_creation","tags":["save","negative"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":"182","weight":"84","fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":false},"state":{"phase":"plan_creation","messages":[{"role":"ai","text":"Предлагаю такой план: понедельник — верх, среда — низ, пятница — всё тело."}]},"input":{"text":"а можно вместо приседа что-то другое?"},"expect":{"tools":{"mustNot":["<SAVE_PLAN_TOOL>"]},"text":{"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"PC-0007","phase":"plan_creation","tags":["save","positive"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":"182","weight":"84","fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":false},"state":{"phase":"plan_creation","messages":[{"role":"ai","text":"Предлагаю такой план: понедельник — верх, среда — низ, пятница — всё тело. Сохраняем?"}]},"input":{"text":"да, сохраняй"},"expect":{"tools":{"must":["<SAVE_PLAN_TOOL>"]},"text":{"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"PC-0008","phase":"plan_creation","tags":["constraints"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":"182","weight":"84","fitnessLevel":"beginner","fitnessGoal":"weight_loss","registrationCompleted":true},"hasActivePlan":false},"state":{"phase":"plan_creation","messages":[]},"input":{"text":"2 раза в неделю по 30 минут, дома без оборудования"},"expect":{"text":{"mustNotMatch":["(?i)штанг|тренажёр|тренажер"],"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"PC-0009","phase":"plan_creation","tags":["off-topic","negative"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":"182","weight":"84","fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":false},"state":{"phase":"plan_creation","messages":[]},"input":{"text":"а какие витамины пить?"},"expect":{"tools":{"mustNot":["<SAVE_PLAN_TOOL>"]},"text":{"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"PC-0010","phase":"plan_creation","tags":["truthfulness"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":"182","weight":"84","fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":false},"state":{"phase":"plan_creation","messages":[]},"input":{"text":"ты уже сохранил мою программу?"},"expect":{"tools":{"mustNot":["<SAVE_PLAN_TOOL>"]},"text":{"mustNotMatch":["(?i)да, сохранил|уже сохранил"],"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
```

- [ ] **Step 3: Validate and commit**

Run: `npx tsx -e "import {parseCases} from './evals/schema/case.schema'; import {readFileSync} from 'node:fs'; const c = parseCases(readFileSync('./evals/datasets/plan_creation/id-reuse.jsonl','utf8')); console.log(c.length, 'cases OK');"`
Expected: `10 cases OK`.

```bash
git add evals/datasets/plan_creation/ evals/datasets/README.md
git commit -m "feat(evals): add plan-creation dataset covering prerequisites, search and save discipline"
```

---

### Task 3: Write the session-planning dataset

Session planning's rule (SP-1) is unusual and easy to check: exactly one contextual question *before* proposing — so the first reply must contain neither a session start nor an exercise list.

**Files:**
- Create: `apps/server/evals/datasets/session_planning/one-question-first.jsonl` (≥10 cases)
- Modify: `apps/server/evals/datasets/README.md`

**Interfaces:**
- Consumes: the tool names in `src/infra/ai/graph/tools/session-planning.tools.ts`.
- Produces: ten `SP-*` cases.

- [ ] **Step 1: Read the real tool names**

Run: `grep -n "name:" src/infra/ai/graph/tools/session-planning.tools.ts`
Substitute the real names for `<START_TOOL>` below.

- [ ] **Step 2: Write the dataset**

Create `apps/server/evals/datasets/session_planning/one-question-first.jsonl`:

```jsonl
{"id":"SP-0001","phase":"session_planning","tags":["one-question-first"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":"182","weight":"84","fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":true},"state":{"phase":"session_planning","messages":[]},"input":{"text":"давай тренировку"},"expect":{"tools":{"mustNot":["<START_TOOL>"]},"text":{"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"SP-0002","phase":"session_planning","tags":["one-question-first"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":"182","weight":"84","fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":true},"state":{"phase":"session_planning","messages":[]},"input":{"text":"что сегодня тренируем?"},"expect":{"tools":{"mustNot":["<START_TOOL>"]},"text":{"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"SP-0003","phase":"session_planning","tags":["adaptation"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":"182","weight":"84","fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":true},"state":{"phase":"session_planning","messages":[{"role":"ai","text":"Как самочувствие и сколько времени есть сегодня?"}]},"input":{"text":"есть только 30 минут"},"expect":{"tools":{"mustNot":["<START_TOOL>"]},"text":{"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"SP-0004","phase":"session_planning","tags":["adaptation","soreness"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":"182","weight":"84","fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":true},"state":{"phase":"session_planning","messages":[{"role":"ai","text":"Как самочувствие?"}]},"input":{"text":"ноги ещё болят после вторника"},"expect":{"tools":{"mustNot":["<START_TOOL>"]},"text":{"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"SP-0005","phase":"session_planning","tags":["start","positive"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":"182","weight":"84","fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":true},"state":{"phase":"session_planning","messages":[{"role":"ai","text":"Как самочувствие?"},{"role":"human","text":"отлично"},{"role":"ai","text":"Тогда Upper A: жим лёжа 4х8, тяга 4х10, жим стоя 3х10. Поехали?"}]},"input":{"text":"да, поехали"},"expect":{"tools":{"must":["<START_TOOL>"]},"text":{"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"SP-0006","phase":"session_planning","tags":["start","negative"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":"182","weight":"84","fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":true},"state":{"phase":"session_planning","messages":[{"role":"ai","text":"Тогда Upper A: жим лёжа 4х8, тяга 4х10, жим стоя 3х10. Поехали?"}]},"input":{"text":"а можно без жима стоя?"},"expect":{"tools":{"mustNot":["<START_TOOL>"]},"text":{"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"SP-0007","phase":"session_planning","tags":["cancel"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":"182","weight":"84","fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":true},"state":{"phase":"session_planning","messages":[{"role":"ai","text":"Тогда Upper A: жим лёжа 4х8, тяга 4х10. Поехали?"}]},"input":{"text":"нет, передумал, не сегодня"},"expect":{"tools":{"must":["request_transition"],"mustNot":["<START_TOOL>"]},"text":{"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"SP-0008","phase":"session_planning","tags":["off-topic"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":"182","weight":"84","fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":true},"state":{"phase":"session_planning","messages":[]},"input":{"text":"а что почитать про питание?"},"expect":{"tools":{"mustNot":["<START_TOOL>"]},"text":{"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"SP-0009","phase":"session_planning","tags":["no-ids-in-text"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":"182","weight":"84","fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":true},"state":{"phase":"session_planning","messages":[{"role":"ai","text":"Как самочувствие?"},{"role":"human","text":"нормально"}]},"input":{"text":"давай предлагай"},"expect":{"text":{"mustNotMatch":["\\{|\\}"],"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"SP-0010","phase":"session_planning","tags":["truthfulness","adversarial"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":"182","weight":"84","fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":true},"state":{"phase":"session_planning","messages":[]},"input":{"text":"тренировка уже началась?"},"expect":{"tools":{"mustNot":["<START_TOOL>"]},"text":{"mustNotMatch":["(?i)да, началась|уже идёт"],"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
```

- [ ] **Step 3: Validate and commit**

Run: `npx tsx -e "import {parseCases} from './evals/schema/case.schema'; import {readFileSync} from 'node:fs'; const c = parseCases(readFileSync('./evals/datasets/session_planning/one-question-first.jsonl','utf8')); console.log(c.length, 'cases OK');"`
Expected: `10 cases OK`.

```bash
git add evals/datasets/session_planning/ evals/datasets/README.md
git commit -m "feat(evals): add session-planning one-question-first dataset"
```

---

### Task 4: Add baseline write and compare modes to the runner

A baseline is a committed record of what each check did at a known model and prompt version, plus the ability to diff a later run against it.

**Files:**
- Create: `apps/server/evals/lib/baseline.ts`
- Create: `apps/server/evals/lib/__tests__/baseline.unit.test.ts`
- Modify: `apps/server/evals/run.ts` (accept `--baseline write|compare` and `--baseline-version`)

**Interfaces:**
- Consumes: `CheckResult`, `LevelReport` (harness plan Task 1).
- Produces:

```typescript
export interface BaselineEntry { case: string; check: string; passed: boolean; detail?: string }
export interface Baseline {
  version: string;
  model: string;
  samples: number;
  recordedAt: string;
  entries: BaselineEntry[];
}
export function writeBaseline(version: string, phase: string, model: string, samples: number, results: CheckResult[]): string;
export function compareToBaseline(version: string, phase: string, results: CheckResult[]): BaselineDiff;
export interface BaselineDiff { regressions: BaselineEntry[]; improvements: BaselineEntry[]; missing: string[]; added: string[] }
```

P2's AC-1322 consumes `compareToBaseline`.

- [ ] **Step 1: Write the failing baseline test**

Create `apps/server/evals/lib/__tests__/baseline.unit.test.ts`:

```typescript
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { compareToBaseline, writeBaseline } from '../baseline';

const results = [
  { case: 'CH-0001', check: 'tools.must:request_transition', passed: true },
  { case: 'CH-0004', check: 'tools.mustNot:request_transition', passed: false },
];

describe('baselines', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'evals-'));
    process.env['EVAL_BASELINE_DIR'] = dir;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env['EVAL_BASELINE_DIR'];
  });

  it('writes a baseline recording the model and every check', () => {
    const path = writeBaseline('v0', 'chat', 'z-ai/glm-5.3', 3, results);
    expect(path).toContain('v0');
    const diff = compareToBaseline('v0', 'chat', results);
    expect(diff.regressions).toEqual([]);
    expect(diff.improvements).toEqual([]);
  });

  it('reports a check that used to pass and now fails as a regression', () => {
    writeBaseline('v0', 'chat', 'z-ai/glm-5.3', 3, results);
    const worse = [{ ...results[0]!, passed: false }, results[1]!];
    expect(compareToBaseline('v0', 'chat', worse).regressions).toHaveLength(1);
  });

  it('reports a check that used to fail and now passes as an improvement', () => {
    writeBaseline('v0', 'chat', 'z-ai/glm-5.3', 3, results);
    const better = [results[0]!, { ...results[1]!, passed: true }];
    expect(compareToBaseline('v0', 'chat', better).improvements).toHaveLength(1);
  });

  it('lists checks present in the baseline but absent from the run', () => {
    writeBaseline('v0', 'chat', 'z-ai/glm-5.3', 3, results);
    expect(compareToBaseline('v0', 'chat', [results[0]!]).missing).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test:unit -- baseline`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement baselines**

Create `apps/server/evals/lib/baseline.ts`:

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { CheckResult } from './reporter';

export interface BaselineEntry {
  case: string;
  check: string;
  passed: boolean;
  detail?: string;
}

export interface Baseline {
  version: string;
  model: string;
  samples: number;
  recordedAt: string;
  entries: BaselineEntry[];
}

export interface BaselineDiff {
  regressions: BaselineEntry[];
  improvements: BaselineEntry[];
  missing: string[];
  added: string[];
}

function baselineDir(): string {
  return process.env['EVAL_BASELINE_DIR'] ?? join(import.meta.dirname, '..', 'baselines');
}

function baselinePath(version: string, phase: string): string {
  return join(baselineDir(), version, `${phase}.json`);
}

const key = (entry: { case: string; check: string }): string => `${entry.case}::${entry.check}`;

export function writeBaseline(
  version: string,
  phase: string,
  model: string,
  samples: number,
  results: CheckResult[],
): string {
  const path = baselinePath(version, phase);
  mkdirSync(join(baselineDir(), version), { recursive: true });
  const baseline: Baseline = {
    version,
    model,
    samples,
    recordedAt: new Date().toISOString(),
    entries: results.map(r => ({ case: r.case, check: r.check, passed: r.passed, detail: r.detail })),
  };
  writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  return path;
}

export function readBaseline(version: string, phase: string): Baseline {
  const path = baselinePath(version, phase);
  if (!existsSync(path)) {
    throw new Error(`No baseline at ${path} — write one first with --baseline write`);
  }
  return JSON.parse(readFileSync(path, 'utf8')) as Baseline;
}

export function compareToBaseline(version: string, phase: string, results: CheckResult[]): BaselineDiff {
  const baseline = readBaseline(version, phase);
  const before = new Map(baseline.entries.map(e => [key(e), e]));
  const after = new Map(results.map(r => [key(r), r]));

  const regressions: BaselineEntry[] = [];
  const improvements: BaselineEntry[] = [];
  const missing: string[] = [];

  for (const [k, entry] of before) {
    const now = after.get(k);
    if (!now) {
      missing.push(k);
      continue;
    }
    if (entry.passed && !now.passed) {
      regressions.push({ case: now.case, check: now.check, passed: false, detail: now.detail });
    }
    if (!entry.passed && now.passed) {
      improvements.push({ case: now.case, check: now.check, passed: true, detail: now.detail });
    }
  }

  const added = [...after.keys()].filter(k => !before.has(k));
  return { regressions, improvements, missing, added };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm run test:unit -- baseline`
Expected: PASS, all four cases.

- [ ] **Step 5: Wire the modes into the runner**

In `apps/server/evals/run.ts`, after the results are produced and before `printReport`, add:

```typescript
  const baselineMode = argValue('--baseline', '');
  const baselineVersion = argValue('--baseline-version', 'v0');

  if (baselineMode === 'write') {
    const { loadConfig } = await import('@config/index');
    const { writeBaseline } = await import('./lib/baseline');
    const model = loadConfig().LLM_MODEL;
    const path = writeBaseline(baselineVersion, phase, model, samples, results);
    console.log(`Baseline ${baselineVersion}/${phase} written to ${path} (model ${model}, ${samples} samples)`);
  } else if (baselineMode === 'compare') {
    const { compareToBaseline } = await import('./lib/baseline');
    const diff = compareToBaseline(baselineVersion, phase, results);
    console.log(
      `vs baseline ${baselineVersion}: ${diff.regressions.length} regressions, ${diff.improvements.length} improvements, ${diff.missing.length} missing, ${diff.added.length} new checks`,
    );
    for (const r of diff.regressions) {
      console.error(`REGRESSION  ${r.case} :: ${r.check}`);
    }
  }
```

When `--baseline write` is used with `--phase all`, write one file per phase — loop the phases rather than writing a single combined file, so a later single-phase compare still works.

- [ ] **Step 6: Check the modes are reachable**

Run: `npm run evals -- --level L0 --baseline write --baseline-version smoke`
Expected: a baseline file appears under `evals/baselines/smoke/`. Delete it afterwards: `rm -rf evals/baselines/smoke`.

- [ ] **Step 7: Commit**

```bash
git add evals/lib/baseline.ts evals/lib/__tests__/baseline.unit.test.ts evals/run.ts
git commit -m "feat(evals): add baseline write and compare modes"
```

---

### Task 5: Record the v0 baseline (AC-1303)

The measurement that P0 exists for. Five phases, fifty cases, three samples each.

**Files:**
- Create: `apps/server/evals/baselines/v0/{registration,chat,plan_creation,session_planning,training}.json`
- Modify: this plan file (record the summary numbers)

**Interfaces:**
- Consumes: every dataset and the baseline writer.
- Produces: the committed `v0` baseline — the reference for AC-1322 and every later phase.

**Recorded v0 results (2026-09-14, model `glm-5.3`, 3 samples, majority ≥2/3 per check):**

| Phase | Passing | Failing checks |
|---|---|---|
| registration | 52/52 (100%) | — |
| chat | 60/60 (100%) | — |
| plan_creation | 49/51 | `PC-0004 tools.must:search_exercises` 0/3; `PC-0007 tools.must:save_workout_plan` 0/3 |
| session_planning | 51/52 | `SP-0005 tools.must:start_training_session` 0/3 |
| training | 52/52 (100%) | — |
| **total** | **264/267 (98.9%)** | |

All three failures are the same shape: the model replies with text (often re-greeting or
re-stating the plan) and never issues the required tool call — verified for PC-0004 by a
direct probe (`threw: no`, `toolCalls: []`), so these are prompt behaviour recorded as
failing, not harness gaps. No `runs-without-throwing` failure occurred in any phase.

**Observed flakiness (noise floor for AC-1322):** a fresh 3-sample chat re-run against v0
compared clean — 0 regressions, 0 improvements, 0 missing, 0 new checks. Single-sample
churn is real but absorbed by the majority vote: the 1-sample dry run failed 8 checks
(including RG-0002/RG-0005/CH-0006 maxChars and TR-0008/TR-0010) of which only 3 survived
at 3 samples. The ±2-point band therefore has ample headroom at the check level.

- [ ] **Step 1: Run L0 across everything first**

Run: `npm run evals -- --level L0`
Expected: exit 0. A phase whose prompt cannot even render must not be baselined — fix the harness wiring first.

- [ ] **Step 2: Dry-run one sample across all phases**

Run: `RUN_LLM_EVALS=1 npm run evals -- --level L1 --phase all --samples 1`
Expected: all fifty cases execute. Check specifically that no phase reports every case as `runs-without-throwing: false` — that is a stub gap in `buildStubDeps`, not a prompt result. Fix any such gap before spending a three-sample run.

- [ ] **Step 3: Write the baseline**

Run: `RUN_LLM_EVALS=1 npm run evals -- --level L1 --phase all --samples 3 --baseline write --baseline-version v0`
Expected: five files under `evals/baselines/v0/`, each recording the model, the sample count and every check's outcome.

- [ ] **Step 4: Sanity-check the baseline content**

Run: `for f in evals/baselines/v0/*.json; do echo "$f: $(node -e "const b=require('./$f'); console.log(b.entries.filter(e=>e.passed).length+'/'+b.entries.length+' passing, model '+b.model)")"; done`
Expected: a line per phase. A phase at 100% passing deserves suspicion — it usually means its assertions never ran. A phase at 0% means the harness, not the prompts, is broken. Investigate either before committing.

- [ ] **Step 5: Verify compare is a no-op against the freshly written baseline**

Run: `RUN_LLM_EVALS=1 npm run evals -- --level L1 --phase chat --samples 3 --baseline compare --baseline-version v0`
Expected: few or no regressions. Some churn is expected — the model is sampled, not deterministic — and that churn is itself useful information: record the observed flakiness in this plan, because it sets the noise floor P2's ±2-point band has to clear.

- [ ] **Step 6: Record the numbers and commit**

Write the per-phase pass counts and the observed flakiness from Step 5 into this plan under this task, then:

```bash
git add evals/baselines/v0/ docs/superpowers/plans/refactor-p0-eval-baseline.md
git commit -m "feat(evals): record the v0 baseline for the current prompts across all five phases"
```

---

### Task 6: Freeze the datasets and document the contract

Once a baseline references the cases, BR-EVAL-001 makes them immutable. That rule needs to be visible where someone would otherwise edit a case.

**Files:**
- Modify: `apps/server/evals/datasets/README.md` (record that v0 now references every case)
- Modify: `docs/PROMPT_EVAL_FRAMEWORK.md` (if and only if something measured here contradicts it — otherwise leave it alone)

**Interfaces:**
- Consumes: the committed baseline.
- Produces: the documentation half of P0's safety net.

- [ ] **Step 1: Mark the datasets frozen**

Add to `apps/server/evals/datasets/README.md`:

```markdown
## Frozen by baseline v0

Every case listed above is referenced by `evals/baselines/v0/*.json`. Per BR-EVAL-001 a
referenced case is **immutable**: to change what a case asserts, add a new case with a new
id and set `"deprecated": true` on the old one. Editing a frozen case silently invalidates
every comparison made against v0.

Re-run a comparison with:

    RUN_LLM_EVALS=1 npm run evals -- --level L1 --phase <phase> --samples 3 --baseline compare --baseline-version v0
```

- [ ] **Step 2: Check the spec against what was actually built**

Re-read `docs/PROMPT_EVAL_FRAMEWORK.md` §3–§4.2 next to the shipped `evals/`. Where the implementation deliberately differs (case counts in P0, tool-call capture reading the checkpoint rather than the run row), the plan already states why — but if the durable spec now says something **false** about the code, that is a docs-currency finding: report it to the owner rather than silently editing, per the repo's "never silently edit durable specs" rule.

- [ ] **Step 3: Run the full local check suite**

Run: `npm run type-check && npm run lint && npm run test:unit && npm run evals -- --level L0`
Expected: exit 0 on all four.

- [ ] **Step 4: Commit**

```bash
git add evals/datasets/README.md
git commit -m "docs(evals): freeze the v0 datasets and document the immutability contract"
```

---

## Close-out

Follow `superpowers:finishing-a-development-branch`. Before merge: run the `close-out-review` skill, tick every checkbox above, set `- Status: done`, run `node scripts/state.mjs --write` from the repo root, and commit. `node scripts/state.mjs --check` must pass.

With this plan merged, AC-1303 is complete. AC-1301, AC-1302 and AC-1304 are closed by the earlier P0 plans; the remaining P0 deliverable is the transcript export script (`refactor-p0-transcript-export`), after which P0 is done and P1 may begin.
