import sources from 'virtual:blacksite-skills'
import { invocationOf, parseFrontmatter, referenceNotes, titleOf, type Reference, type Skill } from './skill-meta'

export { examples, referenceGroups, steps } from './skill-meta'

export const skills: Skill[] = Object.entries(sources).filter(([file]) => file.endsWith('/SKILL.md')).map(([file, source]) => {
  const folder = file.split('/')[0]!
  const fields = parseFrontmatter(source)
  const description = fields.description ?? ''
  return {
    name: fields.name ?? folder,
    description,
    summary: description.split(/(?<=\.)\s+(?=Use )/)[0]!,
    invocation: invocationOf(fields),
    argument: fields['argument-hint'],
    path: `skills/${file}`,
  }
})

export const references: Reference[] = Object.entries(sources).filter(([file]) => file.includes('/references/')).map(([file, source]) => {
  const name = file.split('/').pop()!.replace(/\.md$/, '')
  const note = referenceNotes[name]
  return { name, title: note?.label ?? titleOf(source), summary: note?.summary ?? '', path: `skills/${file}` }
})
