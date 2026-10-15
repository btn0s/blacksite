import { createMachine } from 'xstate';
export const matchMachine = createMachine({
  id: 'destruction',
  initial: 'loading',
  states: {
    failed: { on: { RESET: 'loading' } },
    loading: { on: { FAIL: 'failed', READY: 'running' } },
    paused: {
      on: {
        FAIL: 'failed',
        REPLAY: 'replaying',
        RESET: 'loading',
        RESUME: 'running',
      },
    },
    replaying: {
      on: {
        COMPLETE: 'paused',
        FAIL: 'failed',
        PAUSE: 'paused',
        RESET: 'loading',
      },
    },
    running: {
      on: {
        FAIL: 'failed',
        PAUSE: 'paused',
        REPLAY: 'replaying',
        RESET: 'loading',
      },
    },
  },
});
export const regionMachine = createMachine({
  id: 'region',
  initial: 'dormant',
  states: {
    active: { on: { REPAIR: 'repairing', SETTLED: 'cooling' } },
    cooling: { on: { IMPACT: 'active', SLEEP: 'dormant' } },
    dormant: { on: { IMPACT: 'active', REPAIR: 'repairing' } },
    repairing: { on: { RESTORED: 'dormant' } },
  },
});
