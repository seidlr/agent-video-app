import skillMarkdown from '../../skills/agent-video-studio/SKILL.md?raw';

/** The literal file content, frontmatter included -- what the Skill panel's "Copy SKILL.md"
 * button hands back, since that's meant to be a real, installable copy of the file. */
export const SKILL_MARKDOWN = skillMarkdown;

/** Strips SKILL.md's own frontmatter block -- the frontmatter is discovery/manifest metadata
 * (name, description, license, ...) for `index.json`, not part of the skill's instructional
 * content, and reads as noise when an agent asks `get_agent_skill` for how to use this app. */
export const SKILL_BODY = skillMarkdown.replace(/^---\n[\s\S]*?\n---\n/, '');

export interface SkillSection {
  heading: string;
  body: string;
}

/** Splits the skill body into `{heading, body}` sections at each level-2 (`## `) Markdown
 * heading. Anything before the first `## ` heading (the title + intro paragraph) has no heading
 * of its own and is grouped under the empty-string key, always included regardless of filter. */
export function splitIntoSections(markdown: string): SkillSection[] {
  const parts = markdown.split(/^## /m);
  const sections: SkillSection[] = [{ heading: '', body: parts[0]!.trimEnd() }];
  for (const part of parts.slice(1)) {
    const newlineIndex = part.indexOf('\n');
    sections.push({ heading: part.slice(0, newlineIndex), body: `## ${part}`.trimEnd() });
  }
  return sections;
}

/** Case-insensitive substring match against a section heading, used by both `get_agent_skill
 * {section}` and (once Task 10's Skill panel lands) any section-jump UI. */
export function findSection(query: string): SkillSection | undefined {
  const sections = splitIntoSections(SKILL_BODY);
  const needle = query.toLowerCase();
  return sections.find((s) => s.heading.toLowerCase().includes(needle));
}

export function listSectionHeadings(): string[] {
  return splitIntoSections(SKILL_BODY)
    .filter((s) => s.heading)
    .map((s) => s.heading);
}
