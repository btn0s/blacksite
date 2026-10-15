'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { RuntimeConfig, RuntimeWorld } from '../../ai-schema/src';
import { createWardenSession, resolveWardenConfig, type WardenConfig, type WardenWorkerFactory } from './session';

export type UseWardenOptions = {
  config?: WardenConfig;
  world?: RuntimeWorld;
  /** Keep this function stable (module scope or useCallback). Changing it starts a fresh session. */
  workerFactory?: WardenWorkerFactory;
};

/** A local, paused-on-start worker session. Render never creates a worker. */
export function useWarden({ config, world, workerFactory }: UseWardenOptions = {}) {
  const session = useMemo(() => createWardenSession({ workerFactory }), [workerFactory]);
  // Compare serializable content, so ordinary inline option objects do not reset every render.
  const configKey = JSON.stringify(resolveWardenConfig(config));
  const worldKey = world === undefined ? '' : JSON.stringify(world);
  const inputs = useMemo(() => ({
    config: JSON.parse(configKey) as RuntimeConfig,
    world: worldKey ? JSON.parse(worldKey) as RuntimeWorld : undefined,
  }), [configKey, worldKey]);
  useEffect(() => {
    session.connect(inputs.config, inputs.world);
    return session.disconnect;
  }, [session, inputs]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  return useMemo(() => ({
    ...state,
    play: session.play,
    pause: session.pause,
    step: session.step,
    reset: session.reset,
    command: session.command,
    exportReplay: session.exportReplay,
  }), [state, session]);
}

export type WardenControls = ReturnType<typeof useWarden>;
