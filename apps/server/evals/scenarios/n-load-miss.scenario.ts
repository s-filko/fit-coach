import { nLoadScenarioOf, N_LOAD_CASES } from './n-load-shared';

/** Journey n-load-miss — a miss below the floor (coach-quality-proof T2 / AC-CQ-2). */
const caseOf = N_LOAD_CASES.find(c => c.id === 'n-load-miss')!;

export const scenario = nLoadScenarioOf(caseOf);
