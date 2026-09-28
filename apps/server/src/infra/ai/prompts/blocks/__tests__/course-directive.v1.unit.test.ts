/**
 * COURSE_DIRECTIVE_V1 (course-check plan Task 1, AC-FL-5): the persisted
 * directive renders as ONE prompt block — vector, constraints, questions,
 * suspected-stale facts, exercise verdicts — with an explicit precedence
 * line: the user's current message always outranks the stored directive.
 * Pure (BR-LLM-007): the directive is already-loaded data.
 */
import type { CourseCheckDirective } from '@infra/ai/course-check/directive';

import { renderBlock } from '../index';
import { COURSE_DIRECTIVE_V1 } from '../course-directive.v1';

const DIRECTIVE: CourseCheckDirective = {
  vector: 'Build muscle 3×/week, upper/lower split',
  constraints: ['Left shoulder: no heavy overhead pressing'],
  questions: ['How does the shoulder feel today?'],
  suspectFacts: ['Sleep quality fact is 10 days old'],
  exerciseVerdicts: [{ exercise: 'Overhead Press', verdict: 'replace with landmine press while the shoulder heals' }],
};

describe('COURSE_DIRECTIVE_V1 (AC-FL-5: one block, precedence stated)', () => {
  it('renders the directive as one `## Course Directive` block with every field', () => {
    const text = renderBlock(COURSE_DIRECTIVE_V1, { directive: DIRECTIVE });

    expect(text).toContain('## Course Directive');
    expect(text).toContain(DIRECTIVE.vector);
    expect(text).toContain('Left shoulder: no heavy overhead pressing');
    expect(text).toContain('How does the shoulder feel today?');
    expect(text).toContain('Sleep quality fact is 10 days old');
    expect(text).toContain('Overhead Press');
    expect(text).toContain('landmine press');
  });

  it('states that the user’s current message outranks the directive', () => {
    const text = renderBlock(COURSE_DIRECTIVE_V1, { directive: DIRECTIVE });

    expect(text).toContain('always outranks this directive');
  });

  it('a minimal directive (empty lists) still renders the course and the precedence line', () => {
    const text = renderBlock(COURSE_DIRECTIVE_V1, {
      directive: {
        vector: 'General fitness, no fixed plan yet',
        constraints: [],
        questions: [],
        suspectFacts: [],
        exerciseVerdicts: [],
      },
    });

    expect(text).toContain('## Course Directive');
    expect(text).toContain('General fitness');
    expect(text).not.toContain('Constraints in force');
    expect(text).toMatch(/outrank|always wins|takes precedence/i);
  });
});
