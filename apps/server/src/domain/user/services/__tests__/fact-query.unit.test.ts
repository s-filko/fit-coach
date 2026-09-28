/**
 * fact-query (BUG-020): the pure matcher behind manage_fact's `factQuery` —
 * when the model has no factId, a free-text description of what the user
 * called the fact must resolve to the active facts it refers to. Simple
 * normalised substring matching, no scoring; ties count as ambiguous.
 */
import { matchFactsByQuery } from '../fact-query';

function fact(id: string, text: string): Matchable {
  return { id, fact: text };
}

type Matchable = Parameters<typeof matchFactsByQuery>[0][number];

describe('matchFactsByQuery (BUG-020)', () => {
  it('a distinctive substring of one fact matches exactly that fact', () => {
    const facts = [
      fact(
        '5b0f8a3e-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'User has a lower back injury — no direct loading of the lower back',
      ),
      fact('5b0f8a3e-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Trains at home with dumbbells only'),
    ];
    expect(matchFactsByQuery(facts, 'lower back injury')).toEqual([facts[0]]);
    expect(matchFactsByQuery(facts, 'dumbbells')).toEqual([facts[1]]);
  });

  it('matching is case-insensitive and whitespace-normalised, with terminal punctuation ignored', () => {
    const facts = [fact('5b0f8a3e-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Dislikes burpees')];
    expect(matchFactsByQuery(facts, '  DISLIKES   Burpees. ')).toEqual([facts[0]]);
  });

  it('two facts both containing the query is AMBIGUOUS — both come back, the caller must not guess', () => {
    const facts = [
      fact('5b0f8a3e-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Left shoulder injury'),
      fact('5b0f8a3e-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Right shoulder injury'),
    ];
    expect(matchFactsByQuery(facts, 'shoulder')).toEqual(facts);
  });

  it('no match is an empty array — the caller says so, never falls back to a guess', () => {
    const facts = [fact('5b0f8a3e-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Dislikes burpees')];
    expect(matchFactsByQuery(facts, 'knee pain')).toEqual([]);
    expect(matchFactsByQuery([], 'anything')).toEqual([]);
  });
});
