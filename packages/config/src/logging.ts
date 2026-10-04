import * as z from 'zod';

export const loggerEnvSchema = z.object({
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: z
    .enum(['true', 'false'], {
      error: 'LOG_PRETTY can only accept true or false',
    })
    .default('false')
    .transform((value) => value === 'true'),
});
