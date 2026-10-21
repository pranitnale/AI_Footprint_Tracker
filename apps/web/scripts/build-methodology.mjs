import { writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '../src/generated/methodology.ts');
const require = createRequire(import.meta.url);
const { buildArticle, browserAuditHref } = require('../../../tools/build-methodology.cjs');
const { article: html } = buildArticle({ browserAuditHref: browserAuditHref() });
if (html.includes('<!-- MODEL-CATALOG -->'))
  throw new Error('Unresolved model catalog in public methodology');
await mkdir(dirname(target), { recursive: true });
await writeFile(target, `// Generated from docs/methodology/content.html.\nexport const methodologyHtml = ${JSON.stringify(html)};\n`, 'utf8');
