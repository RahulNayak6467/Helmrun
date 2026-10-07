import { describe, expect, it } from 'vitest';

import { AppError, RETRYABLE_BY_KIND, type ErrorKind } from './app-error.js';

const ALL_KINDS: readonly ErrorKind[] = [
  'invalid_input',
  'unauthenticated',
  'quota_exceeded',
  'not_found',
  'conflict',
  'payload_too_large',
  'rate_limited',
  'internal',
  'unavailable',
];

describe('AppError', () => {
  it('sets kind, code, message, and name', () => {
    const error = new AppError({ kind: 'conflict', code: 'NAME_TAKEN', message: 'Name taken' });

    expect(error.kind).toBe('conflict');
    expect(error.code).toBe('NAME_TAKEN');
    expect(error.message).toBe('Name taken');
    expect(error.name).toBe('AppError');
  });

  it('keeps the cause when one is given', () => {
    const cause = new Error('underlying');

    const error = new AppError({ kind: 'internal', code: 'BOOM', message: 'Boom', cause });

    expect(error.cause).toBe(cause);
  });

  it('has no own cause property when none is given', () => {
    const error = new AppError({ kind: 'internal', code: 'BOOM', message: 'Boom' });

    expect(Object.hasOwn(error, 'cause')).toBe(false);
  });

  it('is an instance of both AppError and Error', () => {
    const error = new AppError({ kind: 'not_found', code: 'MISSING', message: 'Missing' });

    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
  });

  it.each(ALL_KINDS)('reports retryable from RETRYABLE_BY_KIND for %s', (kind) => {
    const error = new AppError({ kind, code: 'CODE', message: 'Message' });

    expect(error.retryable).toBe(RETRYABLE_BY_KIND[kind]);
  });

  it('is retryable only for rate_limited and unavailable', () => {
    const retryableKinds = ALL_KINDS.filter((kind) => RETRYABLE_BY_KIND[kind]);

    expect(retryableKinds.sort()).toEqual(['rate_limited', 'unavailable']);
  });
});
