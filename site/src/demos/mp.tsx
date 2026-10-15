import { createRoot } from 'react-dom/client'
import { LoopbackSplitView } from '@blacksite/subject'
import { attachPerfProbe } from '@blacksite/ui/perf-overlay'
import { RapierBodyProbe } from './RapierBodyProbe'
import './player.css'

createRoot(document.getElementById('root')!).render(<LoopbackSplitView onCreated={state => attachPerfProbe(state.gl)} physicsProbe={<RapierBodyProbe />} />)
