// Test-only preload (`--import`) for child-process tests: on SIGUSR2 the running
// API hits a fatal error, so tests can exercise the real fatal path through
// main.ts's process handlers. HELMRUN_TEST_FAULT picks the kind.
process.on('SIGUSR2', () => {
  if (process.env.HELMRUN_TEST_FAULT === 'unhandled_rejection') {
    void Promise.reject(new Error('injected unhandled rejection'));
    return;
  }

  setImmediate(() => {
    throw new Error('injected uncaught exception');
  });
});
