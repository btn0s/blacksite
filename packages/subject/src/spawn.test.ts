import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { createLoopbackRoom, createReplica } from '@blacksite/relay'
import { createSubject, type SubjectState } from './controller'
import { useSubjectSpawn } from './spawn'

function CharacterSpawn({ subject }: { subject: SubjectState }) {
  const spawn = useSubjectSpawn(subject.player)
  return createElement('output', null, `${spawn.revision}:${spawn.position.join(',')}`)
}

it('uses a synchronously replayed owner spawn on the first React character render', async () => {
  const room = createLoopbackRoom()
  const first = await room.connect()
  const second = await room.connect()
  const subject = createSubject()
  const replica = createReplica(second, state => {
    if (subject.frame.position.distanceToSquared(state.position) > 4) subject.respawn([state.position.x, state.position.y, state.position.z], state.yaw)
  })
  try {
    expect(replica.states.get(second.id)?.position.x).toBe(3)
    expect(subject.player.spawn).toEqual([3, 0, 0])
    expect(renderToStaticMarkup(createElement(CharacterSpawn, { subject }))).toBe('<output>1:3,0,0</output>')
    subject.respawn([6, 0, 2])
    expect(renderToStaticMarkup(createElement(CharacterSpawn, { subject }))).toBe('<output>2:6,0,2</output>')
  } finally { replica.close(); first.close() }
})
