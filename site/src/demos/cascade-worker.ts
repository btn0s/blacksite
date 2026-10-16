import { installPerfProbe } from '@blacksite/ui/perf-overlay'

installPerfProbe()
if (innerWidth <= 900 || innerHeight <= 500) (document.getElementById('hudDetails') as HTMLDetailsElement).open = false
await import('../../../packages/cascade/src/worker-demo')
