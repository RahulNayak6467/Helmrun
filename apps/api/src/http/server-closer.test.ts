import { once } from 'node:events';
import http from 'node:http';
import net, { type AddressInfo } from 'node:net';

import { describe, expect, it, vi } from 'vitest';

import { createHttpServerCloser } from './server-closer.js';

// server.close() alone keeps serving new requests on open keep-alive
// connections and then waits a full keepAliveTimeout before resolving, so a
// busy client could hold shutdown open until the deadline force-exits.
describe('createHttpServerCloser', () => {
  const HANDLER_DELAY_MS = 200;
  const KEEP_ALIVE_TIMEOUT_MS = 60_000;

  const listen = async (server: http.Server): Promise<number> => {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return (server.address() as AddressInfo).port;
  };

  const startSlowServer = async () => {
    const server = http.createServer({ keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS }, (_req, res) => {
      setTimeout(() => res.end('ok'), HANDLER_DELAY_MS);
    });
    const close = createHttpServerCloser(server);
    const port = await listen(server);
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });

    const get = () =>
      new Promise<http.IncomingMessage>((resolveResponse, reject) => {
        http
          .get({ host: '127.0.0.1', port, agent }, (response) => {
            response.resume();
            response.once('end', () => resolveResponse(response));
          })
          .once('error', reject);
      });

    return { close, agent, get };
  };

  it('lets an in-flight request finish, then closes its connection at once', async () => {
    const { close, agent, get } = await startSlowServer();

    try {
      const inFlight = get();
      await new Promise((resolveDelay) => setTimeout(resolveDelay, HANDLER_DELAY_MS / 4));
      const startedAt = performance.now();

      const [response] = await Promise.all([inFlight, close()]);

      expect(response.statusCode).toBe(200);
      expect(response.headers.connection).toBe('close');
      expect(performance.now() - startedAt).toBeLessThan(HANDLER_DELAY_MS * 5);
    } finally {
      agent.destroy();
    }
  });

  it('stops a client that keeps reusing its connection from holding shutdown open', async () => {
    const { close, agent, get } = await startSlowServer();
    let served = 0;
    let stopClient = false;
    const busyClient = (async () => {
      while (!stopClient) {
        try {
          await get();
          served += 1;
        } catch {
          return;
        }
      }
    })();

    try {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, HANDLER_DELAY_MS * 1.5));
      const servedBeforeClose = served;
      const startedAt = performance.now();

      await close();

      expect(performance.now() - startedAt).toBeLessThan(HANDLER_DELAY_MS * 5);
      // At most the request that was in flight when closing started.
      expect(served - servedBeforeClose).toBeLessThanOrEqual(1);
    } finally {
      stopClient = true;
      agent.destroy();
      await busyClient;
    }
  });

  // A request arriving on a still-busy connection after closing starts, answered
  // synchronously (like liveness or a 404). The closer must see it before the
  // app does, or the headers are already sent with keep-alive.
  it('marks a synchronously answered request Connection: close once closing', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/streaming') {
        // Headers go out before closing starts, so this connection stays reusable.
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.write('a');
        setTimeout(() => res.end('b'), HANDLER_DELAY_MS);
        return;
      }

      res.end('sync');
    });
    const close = createHttpServerCloser(server);
    const port = await listen(server);
    const socket = net.connect(port, '127.0.0.1');
    let raw = '';
    socket.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8');
    });

    try {
      await once(socket, 'connect');
      socket.write('GET /streaming HTTP/1.1\r\nHost: test\r\n\r\n');
      await vi.waitFor(() => {
        expect(raw).toContain('\r\n\r\n');
      });

      const closed = close();
      // Sent after closing started, while the first response is still streaming.
      socket.write('GET /sync HTTP/1.1\r\nHost: test\r\n\r\n');
      await Promise.all([closed, once(socket, 'end')]);

      const responses = raw.split('HTTP/1.1 ').filter(Boolean);
      expect(responses).toHaveLength(2);
      expect(responses[1]).toMatch(/\r\nConnection: close\r\n/i);
    } finally {
      socket.destroy();
    }
  });

  it('resolves for a server that never started listening', async () => {
    const close = createHttpServerCloser(http.createServer());

    await expect(close()).resolves.toBeUndefined();
  });
});
