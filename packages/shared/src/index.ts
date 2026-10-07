export { systemClock, type Clock } from './time/clock.js';
export { createLifecycleState, type LifecycleState } from './lifecycle/lifecycle-state.js';
export type { LifecycleLogger } from './lifecycle/logger.js';
export { isEntryPoint } from './lifecycle/entry-point.js';
export {
  installProcessHandlers,
  type FatalEventType,
  type FatalProcessTarget,
  type ProcessHandlerOptions,
  type ProcessShutdownRequest,
  type ShutdownSignal,
  type UninstallProcessHandlers,
} from './lifecycle/process-handlers.js';
export {
  createShutdownCoordinator,
  type RequestShutdown,
  type ShutdownCoordinatorOptions,
  type ShutdownProcessTarget,
  type ShutdownStep,
} from './lifecycle/shutdown-coordinator.js';
export {
  AppError,
  type ErrorKind,
  type AppErrorOptions,
  RETRYABLE_BY_KIND,
} from './errors/app-error.js';
