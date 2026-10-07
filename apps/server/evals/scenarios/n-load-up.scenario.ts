import { nLoadScenarioOf, N_LOAD_CASES } from './n-load-shared';

/** Journey n-load-up — all sets at the top of the range twice (coach-quality-proof T2 / AC-CQ-2). */
const caseOf = N_LOAD_CASES.find(c => c.id === 'n-load-up')!;

export const scenario = nLoadScenarioOf(caseOf);
