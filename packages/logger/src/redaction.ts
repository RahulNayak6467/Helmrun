// Field names that hold secrets or private values in any application. Apps add
// their own domain-specific paths through `extraRedactPaths` (decision 011).
export const SENSITIVE_FIELD_NAMES = [
  'password',
  'passwordHash',
  'passphrase',
  'secret',
  'clientSecret',
  'client_secret',
  'signingSecret',
  'signing_secret',
  'webhookSecret',
  'webhook_secret',
  'token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'idToken',
  'id_token',
  'sessionToken',
  'session_token',
  'apiKey',
  'api_key',
  'api-key',
  'x-api-key',
  'authorization',
  'Authorization',
  'proxyAuthorization',
  'proxy_authorization',
  'proxy-authorization',
  'cookie',
  'Cookie',
  'setCookie',
  'set_cookie',
  'set-cookie',
  'privateKey',
  'private_key',
  'encryptionKey',
  'encryption_key',
  'credential',
  'credentials',
  'databaseUrl',
  'databaseURL',
  'database_url',
  'DATABASE_URL',
  'TEST_DATABASE_URL',
  'POSTGRES_PASSWORD',
  'TEST_POSTGRES_PASSWORD',
  'DB_PASSWORD',
  'TEST_DB_PASSWORD',
  // Redis/Valkey URLs carry the password: redis://:password@host:port
  'redisUrl',
  'redis_url',
  'REDIS_URL',
  'TEST_REDIS_URL',
  'REDIS_PASSWORD',
  'TEST_REDIS_PASSWORD',
  'connectionString',
  'connection_string',
  'dsn',
  'email',
] as const;

export const REDACTION_CENSOR = '[REDACTED]';

export interface RedactionOptions {
  paths: string[];
  censor: string;
}

const isIdentifier = (value: string): boolean => /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(value);

const propertyPath = (property: string): string =>
  isIdentifier(property) ? property : `[${JSON.stringify(property)}]`;

const nestedPath = (parent: string, property: string): string => {
  const child = propertyPath(property);
  return child.startsWith('[') ? `${parent}${child}` : `${parent}.${child}`;
};

const rootSecretPaths = SENSITIVE_FIELD_NAMES.map(propertyPath);

// Configuration objects are a common place for credentials and connection strings.
const configurationSecretPaths = SENSITIVE_FIELD_NAMES.map((field) => nestedPath('config', field));

const authenticationSecretPaths = [
  'auth.password',
  'auth.passphrase',
  'auth.secret',
  'auth.clientSecret',
  'auth.token',
  'auth.accessToken',
  'auth.refreshToken',
  'auth.idToken',
  'auth.sessionToken',
  'auth.apiKey',
  'auth.authorization',
  'auth.cookie',
  'auth.privateKey',
  'auth.credentials',
];

const identitySecretPaths = [
  'user.password',
  'user.passwordHash',
  'user.passphrase',
  'user.email',
  'user.token',
  'account.password',
  'account.passwordHash',
  'account.email',
  'account.token',
];

const datastoreSecretPaths = [
  'database.password',
  'database.secret',
  'database.url',
  'database.databaseUrl',
  'database.connectionString',
  'database.dsn',
  'config.database.password',
  'config.database.secret',
  'config.database.url',
  'config.database.databaseUrl',
  'config.database.connectionString',
  'config.database.dsn',
  'redis.url',
  'redis.password',
  'config.redis.url',
  'config.redis.password',
];

const sessionSecretPaths = [
  'session.secret',
  'session.token',
  'session.sessionToken',
  'session.cookie',
];

// Header names are case-sensitive to Pino even though Node normally lowercases them.
const headerSecretPaths = [
  'headers.authorization',
  'headers.Authorization',
  'headers.cookie',
  'headers.Cookie',
  'headers["proxy-authorization"]',
  'headers["Proxy-Authorization"]',
  'headers["x-api-key"]',
  'headers["X-API-Key"]',
  'headers["set-cookie"]',
  'headers["Set-Cookie"]',
  'req.headers.authorization',
  'req.headers.Authorization',
  'req.headers.cookie',
  'req.headers.Cookie',
  'req.headers["proxy-authorization"]',
  'req.headers["Proxy-Authorization"]',
  'req.headers["x-api-key"]',
  'req.headers["X-API-Key"]',
  'request.headers.authorization',
  'request.headers.Authorization',
  'request.headers.cookie',
  'request.headers.Cookie',
  'request.headers["proxy-authorization"]',
  'request.headers["Proxy-Authorization"]',
  'request.headers["x-api-key"]',
  'request.headers["X-API-Key"]',
  'res.headers["set-cookie"]',
  'res.headers["Set-Cookie"]',
  'response.headers["set-cookie"]',
  'response.headers["Set-Cookie"]',
];

// Whole request/response payloads are private by default; log operational
// metadata (status, duration, IDs) separately instead.
const privatePayloadPaths = [
  'body',
  'payload',
  'requestBody',
  'responseBody',
  'req.body',
  'request.body',
  'res.body',
  'response.body',
  'http.request.body',
  'http.response.body',
];

// One level of nesting under any parent, for the most sensitive names, so
// `{ options: { password } }` is caught even though `options` isn't listed above.
// Kept short: wildcard paths cost more per log call than exact ones.
const wildcardSecretPaths = [
  '*.password',
  '*.secret',
  '*.token',
  '*.apiKey',
  '*.authorization',
  '*.cookie',
  '*.privateKey',
  '*.connectionString',
  '*.databaseUrl',
];

export const BASE_REDACTION_PATHS = Object.freeze([
  ...wildcardSecretPaths,
  ...rootSecretPaths,
  ...configurationSecretPaths,
  ...authenticationSecretPaths,
  ...identitySecretPaths,
  ...datastoreSecretPaths,
  ...sessionSecretPaths,
  ...headerSecretPaths,
  ...privatePayloadPaths,
]);

// Returns a fresh array every time so a logger can't mutate the shared policy.
export const createRedactionOptions = (extraPaths: readonly string[] = []): RedactionOptions => ({
  paths: [...new Set([...BASE_REDACTION_PATHS, ...extraPaths])],
  censor: REDACTION_CENSOR,
});
