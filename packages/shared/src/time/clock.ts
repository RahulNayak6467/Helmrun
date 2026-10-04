// Time behind an interface so tests can control it instead of sleeping or
// racing the real clock.
export interface Clock {
  // Wall-clock time (epoch ms) for timestamps. Can jump when the system clock
  // is adjusted (NTP), so never subtract two readings to measure a duration.
  nowMs(): number;
  // Monotonic time (ms, arbitrary origin) for measuring durations. Never goes
  // backwards or jumps; meaningless as a timestamp.
  monotonicMs(): number;
}

export const systemClock: Clock = {
  nowMs: () => Date.now(),
  monotonicMs: () => performance.now(),
};
