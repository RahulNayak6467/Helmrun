import { writeFileSync } from 'node:fs';

import { buildOpenApiDocument } from '../src/http/openapi/document.js';

// Writes apps/api/openapi.json. Run through `pnpm openapi:generate`, which
// formats the file afterwards so CI's stale check compares like with like.
const outputPath = new URL('../openapi.json', import.meta.url);

writeFileSync(outputPath, `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`);
