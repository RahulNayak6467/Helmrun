import { describe, expect, it } from 'vitest';

import { serializeError } from './error-serializer.js';

const pgLikeError = () =>
  Object.assign(new Error('duplicate key value violates unique constraint "users_email_key"'), {
    code: '23505',
    constraint: 'users_email_key',
    table: 'users',
    detail: 'Key (email)=(alice@example.com) already exists.',
    where: 'SQL statement "INSERT INTO users"',
    internalQuery: 'SELECT secret_column FROM users',
  });

describe('serializeError', () => {
  it('keeps only the allowlisted fields of an Error', () => {
    const error = pgLikeError();

    const serialized = serializeError(error);

    expect(serialized).toEqual({
      name: 'Error',
      message: 'duplicate key value violates unique constraint "users_email_key"',
      stack: error.stack,
      code: '23505',
      constraint: 'users_email_key',
      table: 'users',
    });
  });

  it('drops detail, where, and internalQuery from a pg-like error', () => {
    const serialized = serializeError(pgLikeError());

    expect(serialized).not.toHaveProperty('detail');
    expect(serialized).not.toHaveProperty('where');
    expect(serialized).not.toHaveProperty('internalQuery');
    expect(JSON.stringify(serialized)).not.toContain('alice@example.com');
  });

  it('keeps a numeric code', () => {
    const serialized = serializeError(Object.assign(new Error('boom'), { code: 42 }));

    expect(serialized).toHaveProperty('code', 42);
  });

  it('truncates the message to 1,000 characters plus an ellipsis', () => {
    const serialized = serializeError(new Error('m'.repeat(10_000)));

    expect(serialized).toHaveProperty('message', `${'m'.repeat(1_000)}…`);
  });

  it('truncates the stack to 4,000 characters plus an ellipsis', () => {
    const error = new Error('boom');
    error.stack = 's'.repeat(10_000);

    const serialized = serializeError(error);

    expect(serialized).toHaveProperty('stack', `${'s'.repeat(4_000)}…`);
  });

  it.each(['code', 'constraint', 'table'])('truncates a long %s to 200 characters', (field) => {
    const serialized = serializeError(
      Object.assign(new Error('boom'), { [field]: 'f'.repeat(1_000) }),
    );

    expect(serialized).toHaveProperty(field, `${'f'.repeat(200)}…`);
  });

  it('drops a code that is not a string or number', () => {
    const serialized = serializeError(
      Object.assign(new Error('boom'), { code: { nested: 'nested-secret-value' } }),
    );

    expect(serialized.code).toBeUndefined();
    expect(JSON.stringify(serialized)).not.toContain('nested-secret-value');
  });

  it('filters every level of a cause chain', () => {
    const inner = Object.assign(new Error('inner'), { detail: 'inner-detail-value' });
    const outer = new Error('outer', { cause: Object.assign(pgLikeError(), { cause: inner }) });

    const serialized = serializeError(outer);

    expect(serialized).toMatchObject({
      message: 'outer',
      cause: { code: '23505', cause: { message: 'inner' } },
    });
    expect(JSON.stringify(serialized)).not.toContain('alice@example.com');
    expect(JSON.stringify(serialized)).not.toContain('inner-detail-value');
  });

  it('stops after three levels of cause, so a self-referencing cause terminates', () => {
    const looping = new Error('loop');
    looping.cause = looping;

    const serialized = serializeError(looping);

    expect(serialized).toHaveProperty(['cause', 'cause', 'cause', 'message'], 'loop');
    expect(serialized).not.toHaveProperty(['cause', 'cause', 'cause', 'cause']);
  });

  it.each([
    ['a string', 'thrown-secret-value', 'string'],
    ['an object', { password: 'thrown-secret-value' }, 'object'],
    ['null', null, 'object'],
    ['undefined', undefined, 'undefined'],
  ])('reports only the type of %s', (_label, value, thrownType) => {
    const serialized = serializeError(value);

    expect(serialized).toEqual({ thrownType });
    expect(JSON.stringify(serialized)).not.toContain('thrown-secret-value');
  });

  it.each(['code', 'cause', 'message'])(
    'returns loggingFailed when the %s getter throws',
    (property) => {
      const hostile = Object.defineProperty(new Error('hostile'), property, {
        get() {
          throw new Error(`${property} getter failed`);
        },
      });

      expect(serializeError(hostile)).toEqual({ loggingFailed: true });
    },
  );
});
