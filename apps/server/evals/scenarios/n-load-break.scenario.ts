import { nLoadScenarioOf, N_LOAD_CASES } from './n-load-shared';

/** Journey n-load-break — a 3-week break (coach-quality-proof T2 / AC-CQ-2). */
const caseOf = N_LOAD_CASES.find(c => c.id === 'n-load-break')!;

export const scenario = nLoadScenarioOf(caseOf);
