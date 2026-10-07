const MAX_MESSAGE_LENGTH = 1_000;
const MAX_STACK_LENGTH = 4_000;
const MAX_FIELD_LENGTH = 200;
const MAX_CAUSE_DEPTH = 3;

const truncate = (text: string, maxLength: number): string =>
  text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;

const toScalar = (value: unknown): string | number | undefined => {
  if (typeof value === 'string') return truncate(value, MAX_FIELD_LENGTH);
  if (typeof value === 'number') return value;
  return undefined;
};

const serialize = (error: unknown, depth: number): Record<string, unknown> => {
  if (!(error instanceof Error)) {
    return { thrownType: typeof error };
  }

  const fields: Record<string, unknown> = {
    name: error.name,
    message: truncate(error.message, MAX_MESSAGE_LENGTH),
    stack: error.stack === undefined ? undefined : truncate(error.stack, MAX_STACK_LENGTH),
  };

  if ('code' in error) fields.code = toScalar(error.code);
  if ('constraint' in error) fields.constraint = toScalar(error.constraint);
  if ('table' in error) fields.table = toScalar(error.table);

  if (error.cause !== undefined && depth < MAX_CAUSE_DEPTH) {
    fields.cause = serialize(error.cause, depth + 1);
  }

  return fields;
};

export const serializeError = (error: unknown): Record<string, unknown> => {
  try {
    return serialize(error, 0);
  } catch {
    return { loggingFailed: true };
  }
};
