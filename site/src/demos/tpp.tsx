import { createRoot } from 'react-dom/client'
import { attachPerfProbe } from '@blacksite/ui/perf-overlay'
import { RapierBodyProbe } from './RapierBodyProbe'
import './player.css'

const { default: Mode } = await import('../../../templates/prototype-kits/als-tpp/mode')
createRoot(document.getElementById('root')!).render(<Mode onCreated={state => attachPerfProbe(state.gl)} physicsProbe={<RapierBodyProbe />} />)
