import * as z from 'zod';

interface IntegerEnvOptions {
  readonly min: number;
  readonly max: number;
  readonly fallback: number;
  // Unit for messages, e.g. 'milliseconds'.
  readonly unit?: string;
}

const format = (value: number): string => value.toLocaleString('en-US');

// A bounded whole-number env value. Only plain digits are accepted: Number()
// would also take '0x1F90', '1e3', or ' 8080 ', turning typos into valid
// settings. Every value needs an explicit range so a typo can't produce a
// value the runtime can't handle (e.g. timers above Node's 2^31-1 ms limit).
export const integerEnv = (field: string, { min, max, fallback, unit }: IntegerEnvOptions) => {
  const wholeNumber = unit
    ? `${field} must be a whole number of ${unit}`
    : `${field} must be a whole number`;
  const suffix = unit ? ` ${unit}` : '';

  return z
    .string({ error: wholeNumber })
    .regex(/^\d+$/, { error: wholeNumber })
    .default(String(fallback))
    .transform(Number)
    .pipe(
      z
        .number()
        .min(min, { error: `${field} must be at least ${format(min)}${suffix}` })
        .max(max, { error: `${field} must not exceed ${format(max)}${suffix}` }),
    );
};
