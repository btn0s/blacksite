import { createRoot } from 'react-dom/client'
import { attachPerfProbe } from '@blacksite/ui/perf-overlay'
import { App } from '../../../packages/client-r3f/src/App'
import '../../../packages/client-r3f/src/styles.css'

createRoot(document.getElementById('root')!).render(<App onCreated={state => attachPerfProbe(state.gl)} />)
