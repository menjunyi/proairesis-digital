import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const outdir = resolve('build/lambda');
await mkdir(outdir, { recursive: true });
const result = await build({
  entryPoints: ['server/handler.mjs'], outfile: resolve(outdir, 'handler.mjs'),
  bundle: true, platform: 'node', target: 'node22', format: 'esm', sourcemap: false,
  metafile: true, packages: 'bundle',
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
});
await writeFile(resolve('build/lambda-metafile.json'), JSON.stringify(result.metafile, null, 2));
// The CLI-only mammoth argument parser must not enter the deployable runtime.
if (Object.keys(result.metafile.inputs).some(name => /(?:sprintf-js|argparse)/.test(name))) throw new Error('Unexpected CLI parser in Lambda bundle');
execFileSync('zip', ['-q', '-j', resolve('build/lambda.zip'), resolve(outdir, 'handler.mjs')]);
const zip = await readFile(resolve('build/lambda.zip'));
const sha256 = createHash('sha256').update(zip).digest('hex');
await writeFile(resolve('build/lambda.sha256'), `${sha256}\n`);
console.log(JSON.stringify({ zip: 'build/lambda.zip', bytes: zip.length, sha256 }));
