import { useImperativeHandle, useRef, type RefObject } from 'react'
import { formatTime, route } from './model'
import './hud.css'

export type ClockHandle = { set(seconds: number, state: 'ready' | 'running' | 'finished'): void }

type Banner = { title: string; detail: string; tone: 'ahead' | 'behind' | 'even'; key: number }

export function Clock({ handle, checkpoint, total, best, banner, finish, touch, retry }: {
  handle: { current: ClockHandle | null }
  checkpoint: number
  total: number
  best: number[] | null
  banner: Banner | null
  finish: { time: number; best: number; record: boolean } | null
  touch: boolean
  retry: string
}) {
  const time = useRef<HTMLSpanElement>(null)
  const shown = useRef('')
  useImperativeHandle(handle as RefObject<ClockHandle>, () => ({
    set(seconds, state) {
      const text = state === 'ready' ? formatTime(0) : formatTime(seconds)
      if (text === shown.current || !time.current) return
      shown.current = text
      time.current.textContent = text
    },
  }), [])
  const bestTime = best ? best[best.length - 1]! : null
  const medal = finish ? finish.time <= route.goldSeconds ? 'Gold' : finish.time <= route.parSeconds ? 'Par' : null : null
  return <div className={`tr-hud${touch ? ' tr-hud--touch' : ''}`}>
    <div className="tr-clock">
      <span ref={time} className="tr-time">{formatTime(0)}</span>
      <span className="tr-meta"><b>{checkpoint}</b>/{total}{bestTime !== null && <> · best {formatTime(bestTime)}</>}</span>
    </div>
    {banner && <div key={banner.key} className={`tr-split tr-split--${banner.tone}`}><span>{banner.title}</span><strong>{banner.detail}</strong></div>}
    {finish && <div className="tr-finish" role="status">
      <span className="tr-finish-kicker">{finish.record ? 'New best' : 'Finished'}{medal && ` · ${medal}`}</span>
      <strong>{formatTime(finish.time)}</strong>
      <span className="tr-finish-detail">Best {formatTime(finish.best)} · par {formatTime(route.parSeconds)} · gold {formatTime(route.goldSeconds)}</span>
      <span className="tr-finish-detail">{retry}</span>
    </div>}
  </div>
}
