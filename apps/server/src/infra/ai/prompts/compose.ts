import type { DirectiveContext, DirectiveModule, PromptModule, Section } from './types';

/** Today's composeDirectives joined parts with one blank line; phase templates did the same. */
export const SECTION_SEPARATOR = '\n\n';

export function renderDirectives(directives: readonly DirectiveModule[], ctx: DirectiveContext): Section[] {
  const sections: Section[] = [];
  for (const directive of directives) {
    const section = directive.render(ctx);
    if (section) {
      sections.push(section);
    }
  }
  return sections;
}

export function compose(sections: Section[]): string {
  return sections.map(s => s.text).join(SECTION_SEPARATOR);
}

export function sectionText(sections: Section[], id: string): string {
  const found = sections.find(s => s.id === id);
  if (!found) {
    throw new Error(`Prompt section '${id}' not rendered`);
  }
  return found.text;
}

/** BR-LLM-008 — the map recorded on every run (conversation_runs.prompt_versions). */
export function promptVersionsOf(module: PromptModule<unknown>): Record<string, string> {
  const versions: Record<string, string> = { [module.id]: module.version };
  for (const directive of module.directives) {
    versions[`directive.${directive.id}`] = directive.version;
  }
  return versions;
}
