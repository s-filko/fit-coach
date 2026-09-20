/**
 * `{{factId:<text>}}` placeholder resolution for the fact-lifecycle journeys
 * (course-check plan Task 3, AC-FL-7). A scripted coach cannot know a seeded
 * fact's id when the scenario is authored — the id is minted when the run
 * seeds the world — so scripts name the fact by a distinctive piece of its text
 * and the scripted model resolves the id at the moment it answers.
 */
import { and, desc, eq, ilike } from 'drizzle-orm';

import { db } from '@infra/db/drizzle';
import { userFacts } from '@infra/db/schema';

const PLACEHOLDER = /\{\{factId:([^}]+)\}\}/g;

/** The id of the user's fact containing `needle` — an ACTIVE row wins over an archived one, newest first. */
export async function factIdContaining(userId: string, needle: string): Promise<string> {
  const rows = await db
    .select({ id: userFacts.id, status: userFacts.status })
    .from(userFacts)
    .where(and(eq(userFacts.userId, userId), ilike(userFacts.fact, `%${needle}%`)))
    .orderBy(desc(userFacts.createdAt));
  const row = rows.find(r => r.status === 'active') ?? rows[0];
  if (row === undefined) {
    throw new Error(
      `No fact containing "${needle}" for user ${userId} — the journey script names a fact that is not there`,
    );
  }
  return row.id;
}

/** Replaces every `{{factId:<text>}}` in `text` with the resolved id. */
export async function resolveFactPlaceholders(text: string, userId: string): Promise<string> {
  const needles = [...new Set([...text.matchAll(PLACEHOLDER)].map(m => m[1]!))];
  let out = text;
  for (const needle of needles) {
    out = out.split(`{{factId:${needle}}}`).join(await factIdContaining(userId, needle));
  }
  return out;
}
