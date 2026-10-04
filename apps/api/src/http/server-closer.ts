import type http from 'node:http';

// server.close() only refuses new connections. An open keep-alive connection
// keeps serving new requests and stays open for keepAliveTimeout after its last
// one, so a client that reuses its connection could hold shutdown open until
// the deadline force-exits (and the pool never closes). Once closing starts,
// every response not yet sent says `Connection: close`, and each connection is
// closed as soon as its current response is done.
//
// Install before listening: it has to see every request to know which
// responses are still open. Returns the shutdown step's close function, which
// resolves once all connections are gone. A server that never started
// listening counts as already closed.
export const createHttpServerCloser = (server: http.Server): (() => Promise<void>) => {
  const openResponses = new Set<http.ServerResponse>();
  let closing = false;

  // Prepended so it runs before the Express app's listener: a synchronous
  // handler (liveness, 404) sends its headers inside that listener, which
  // would be too late to add `Connection: close`.
  server.prependListener('request', (_request, response) => {
    if (closing && !response.headersSent) response.setHeader('Connection', 'close');

    openResponses.add(response);
    response.once('close', () => {
      openResponses.delete(response);
      // Next tick: the connection only counts as idle once Node has finished
      // with this response.
      if (closing) setImmediate(() => server.closeIdleConnections());
    });
  });

  return () =>
    new Promise((resolve, reject) => {
      closing = true;

      for (const response of openResponses) {
        if (!response.headersSent) response.setHeader('Connection', 'close');
      }

      server.close((error) => {
        if (error === undefined || ('code' in error && error.code === 'ERR_SERVER_NOT_RUNNING')) {
          resolve();
          return;
        }

        reject(error);
      });
      server.closeIdleConnections();
    });
};
