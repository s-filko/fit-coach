import type { CourseCheckDirective } from '@infra/ai/course-check/directive';
import type { PromptModule, Section } from '@infra/ai/prompts/types';

export interface CourseDirectiveContext {
  /** state.courseDirective.directive — already-generated data; null renders no block. */
  directive: CourseCheckDirective;
}

/**
 * `## Course Directive` v1 (course-check plan Task 1, AC-FL-5): the persisted
 * course-check directive, rendered as ONE prompt block — the current vector,
 * the constraints in force, the questions to ask now, the facts suspected
 * stale, and any exercise verdicts. The decision was made once, on an event;
 * this block is how an ordinary turn carries it.
 *
 * The precedence line is part of the contract, not decoration: the user's
 * current message ALWAYS outranks the stored directive — the check looked at
 * the past, the user is speaking in the present.
 *
 * Pure (BR-LLM-007): no I/O, no clock reads — the directive is already-loaded
 * data. Measured by resolveBudget through this same render (its tokens ride
 * in `longTerm`); dropped only at the D-D floor.
 */
export const COURSE_DIRECTIVE_V1: PromptModule<CourseDirectiveContext> = {
  id: 'block.course_directive',
  version: 'v1',
  directives: [],
  render({ directive }): Section[] {
    const lines: string[] = ['## Course Directive', `- Current course: ${directive.vector}`];
    if (directive.constraints.length > 0) {
      lines.push('Constraints in force:');
      lines.push(...directive.constraints.map(c => `- ${c}`));
    }
    if (directive.questions.length > 0) {
      lines.push('Ask now (once, before or during your reply):');
      lines.push(...directive.questions.map(q => `- ${q}`));
    }
    if (directive.suspectFacts.length > 0) {
      lines.push('Possibly stale facts — verify before relying on them:');
      lines.push(...directive.suspectFacts.map(s => `- ${s}`));
    }
    if (directive.exerciseVerdicts.length > 0) {
      lines.push('Exercise verdicts:');
      lines.push(...directive.exerciseVerdicts.map(v => `- ${v.exercise}: ${v.verdict}`));
    }
    lines.push(
      'Precedence: the user’s message in this conversation always outranks this directive — if they say otherwise, they are right.',
    );
    return [
      {
        id: 'course_directive',
        required: false,
        text: lines.join('\n'),
      },
    ];
  },
};
