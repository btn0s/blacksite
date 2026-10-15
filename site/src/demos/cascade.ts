import { installPerfProbe } from '@blacksite/ui/perf-overlay'

installPerfProbe()
await import('../../../packages/cascade/src/large-structure-demo')
