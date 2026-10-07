import { nLoadScenarioOf, N_LOAD_CASES } from './n-load-shared';

/** Journey n-load-early-stop — an early stop with RPE 7 (coach-quality-proof T2 / AC-CQ-2). */
const caseOf = N_LOAD_CASES.find(c => c.id === 'n-load-early-stop')!;

export const scenario = nLoadScenarioOf(caseOf);
