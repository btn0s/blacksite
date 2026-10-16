import sources from 'virtual:blacksite-skills'
import { invocationOf, parseFrontmatter, phases, references, type Skill } from './skill-meta'

export { invocationLabel } from './skill-meta'

export const skills: Skill[] = Object.entries(sources).map(([folder, source]) => {
  const fields = parseFrontmatter(source)
  const description = fields.description ?? ''
  return {
    name: fields.name ?? folder,
    description,
    summary: description.split(/(?<=\.)\s+(?=Use )/)[0]!,
    invocation: invocationOf(fields),
    argument: fields['argument-hint'],
    path: `skills/${folder}/SKILL.md`,
  }
}).sort((a, b) => {
  const rank = (skill: Skill) => { const phase = phases.indexOf(skill.name); return phase >= 0 ? phase : 100 + references.indexOf(skill.name) }
  return rank(a) - rank(b)
})
