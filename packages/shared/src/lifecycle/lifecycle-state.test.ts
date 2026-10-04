import { describe, expect, it } from 'vitest';

import { createLifecycleState } from './lifecycle-state.js';

describe('createLifecycleState', () => {
  it('starts running', () => {
    expect(createLifecycleState().isDraining()).toBe(false);
  });

  it('changes from running to draining exactly once', () => {
    const lifecycle = createLifecycleState();

    expect(lifecycle.beginDraining()).toBe(true);
    expect(lifecycle.isDraining()).toBe(true);
    expect(lifecycle.beginDraining()).toBe(false);
    expect(lifecycle.isDraining()).toBe(true);
  });

  it('keeps state isolated between instances', () => {
    const first = createLifecycleState();
    const second = createLifecycleState();

    first.beginDraining();

    expect(second.isDraining()).toBe(false);
  });
});
