import { createServer } from 'node:net';

// TEST_REDIS_URL only, never REDIS_URL, so a shell export can't reach the dev Valkey.
export const requireTestRedisUrl = (): string => {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Redis integration tests require NODE_ENV=test');
  }

  const redisUrl = process.env.TEST_REDIS_URL;

  if (redisUrl === undefined || redisUrl.length === 0) {
    throw new Error('TEST_REDIS_URL is required for integration tests (see .env.test.example)');
  }

  return redisUrl;
};

// A localhost port nothing listens on, so connecting is refused at once.
export const findClosedPort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('Expected a TCP address'));
        return;
      }

      server.close(() => {
        resolve(address.port);
      });
    });
  });
