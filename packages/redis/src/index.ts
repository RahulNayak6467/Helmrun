import type { createRedisClient } from './redis.js';

export { createRedisClient, type RedisConfig } from './redis.js';
export type { RedisLogger } from './logger.js';

export type RedisConnection = ReturnType<typeof createRedisClient>;
