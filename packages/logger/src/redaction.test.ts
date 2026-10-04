import { Writable } from 'node:stream';

import pino from 'pino';
import { describe, expect, it } from 'vitest';

import {
  BASE_REDACTION_PATHS,
  createRedactionOptions,
  REDACTION_CENSOR,
  SENSITIVE_FIELD_NAMES,
} from './redaction.js';

const secretSentinel = 'secret-value-that-must-never-be-logged';

const writeLog = (event: Record<string, unknown>, extraPaths: readonly string[] = []): string => {
  const chunks: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      callback();
    },
  });
  const logger = pino(
    { base: null, timestamp: false, redact: createRedactionOptions(extraPaths) },
    destination,
  );

  logger.info(event, 'redaction-test');

  return chunks.join('');
};

const expectSecretRedacted = (event: Record<string, unknown>): void => {
  const output = writeLog(event);

  expect(output).not.toContain(secretSentinel);
  expect(output).toContain(REDACTION_CENSOR);
};

describe('log redaction', () => {
  it('keeps the shared path policy immutable and returns a fresh copy each time', () => {
    const first = createRedactionOptions();
    const second = createRedactionOptions();

    first.paths.push('temporary-test-path');

    expect(Object.isFrozen(BASE_REDACTION_PATHS)).toBe(true);
    expect(second.paths).not.toContain('temporary-test-path');
  });

  it('redacts every sensitive field name at the log root', () => {
    expectSecretRedacted(
      Object.fromEntries(SENSITIVE_FIELD_NAMES.map((field) => [field, secretSentinel])),
    );
  });

  it('redacts sensitive values inside a configuration object', () => {
    expectSecretRedacted({
      config: Object.fromEntries(SENSITIVE_FIELD_NAMES.map((field) => [field, secretSentinel])),
    });
  });

  it('redacts authentication, identity, datastore and session secrets', () => {
    expectSecretRedacted({
      auth: { password: secretSentinel, clientSecret: secretSentinel, apiKey: secretSentinel },
      user: { email: secretSentinel, passwordHash: secretSentinel },
      account: { token: secretSentinel },
      database: { url: secretSentinel, connectionString: secretSentinel },
      redis: { url: secretSentinel, password: secretSentinel },
      session: { cookie: secretSentinel, token: secretSentinel },
    });
  });

  it('redacts datastore URLs and passwords from env-style keys', () => {
    expectSecretRedacted({
      DATABASE_URL: secretSentinel,
      TEST_DATABASE_URL: secretSentinel,
      DB_PASSWORD: secretSentinel,
      REDIS_URL: `redis://:${secretSentinel}@127.0.0.1:6390`,
      REDIS_PASSWORD: secretSentinel,
    });
  });

  it('redacts sensitive HTTP headers across common request and response shapes', () => {
    const requestHeaders = {
      authorization: secretSentinel,
      cookie: secretSentinel,
      'proxy-authorization': secretSentinel,
      'x-api-key': secretSentinel,
    };
    const responseHeaders = { 'set-cookie': secretSentinel };

    expectSecretRedacted({
      headers: requestHeaders,
      req: { headers: requestHeaders },
      request: { headers: requestHeaders },
      res: { headers: responseHeaders },
      response: { headers: responseHeaders },
    });
  });

  it('redacts whole HTTP payloads while keeping operational metadata', () => {
    const output = writeLog({
      requestId: 'request-456',
      statusCode: 200,
      durationMs: 25,
      req: { body: { anything: secretSentinel } },
      response: { body: { anything: secretSentinel } },
      payload: { privateValue: secretSentinel },
    });

    expect(output).not.toContain(secretSentinel);
    expect(output).toContain('request-456');
    expect(output).toContain('"statusCode":200');
    expect(output).toContain('"durationMs":25');
  });

  it('keeps app-specific names out of the generic base list', () => {
    expect(BASE_REDACTION_PATHS).not.toContain('prompt');
    expect(BASE_REDACTION_PATHS).not.toContain('llm.messages');
  });

  it('adds app-specific paths on top of the base list without duplicates', () => {
    const options = createRedactionOptions(['prompt', 'llm.messages', 'password']);

    expect(options.paths).toEqual(expect.arrayContaining(['prompt', 'llm.messages', 'password']));
    expect(options.paths.filter((path) => path === 'password')).toHaveLength(1);

    const output = writeLog({ prompt: secretSentinel, llm: { messages: [secretSentinel] } }, [
      'prompt',
      'llm.messages',
    ]);

    expect(output).not.toContain(secretSentinel);
  });

  it('redacts the most sensitive names one level under any parent', () => {
    expectSecretRedacted({
      options: { password: secretSentinel },
      db: { apiKey: secretSentinel, connectionString: secretSentinel },
      upstream: { authorization: secretSentinel, token: secretSentinel },
    });
  });

  it('does not mutate the object supplied to the logger', () => {
    const event = { apiKey: secretSentinel, safe: 'visible-value' };

    expectSecretRedacted(event);

    expect(event).toEqual({ apiKey: secretSentinel, safe: 'visible-value' });
  });
});
