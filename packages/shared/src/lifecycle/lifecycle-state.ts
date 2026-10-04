// Whether this process is still accepting work. Readiness reads it; shutdown
// flips it. One instance per process, created in main.ts.
export interface LifecycleState {
  isDraining(): boolean;
  // Returns true only for the call that actually started draining.
  beginDraining(): boolean;
}

export const createLifecycleState = (): LifecycleState => {
  let state: 'running' | 'draining' = 'running';

  return {
    isDraining: () => state === 'draining',
    beginDraining: () => {
      if (state === 'draining') return false;

      state = 'draining';
      return true;
    },
  };
};
