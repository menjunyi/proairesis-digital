import {readFile, stat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DynamoStore} from '../server/store.mjs';
import {OperatorError, reconcileGeneration} from '../server/operator.mjs';

export function parseArguments(argv) {
  const values = {};
  const allowed = new Set(['table', 'user-sub', 'generation-id', 'resolution', 'evidence', 'operator', 'letter-file']);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--apply') { values.apply = true; continue; }
    if (flag === '--help') { values.help = true; continue; }
    if (!flag.startsWith('--') || !allowed.has(flag.slice(2)) || !argv[i + 1] || argv[i + 1].startsWith('--')) {
      throw new OperatorError('INVALID_ARGUMENTS', 'Unknown or incomplete argument. Use --help.');
    }
    if (flag.slice(2) in values) throw new OperatorError('INVALID_ARGUMENTS', 'Duplicate arguments are not allowed.');
    values[flag.slice(2)] = argv[++i];
  }
  return values;
}

const usage = `Operator-only generation reconciliation. Dry-run is the default.

node scripts/reconcile-generation.mjs --table TABLE --user-sub SUBJECT --generation-id ID

Apply a verified failure (does not retry the provider):
  --apply --resolution failed --evidence SUPPORT_REFERENCE --operator OPERATOR_REFERENCE

Attach an already recovered provider output:
  --apply --resolution succeeded --letter-file /absolute/existing-letter.txt
  --evidence PROVIDER_OR_SUPPORT_REFERENCE --operator OPERATOR_REFERENCE

Requires existing IAM permission for the named DynamoDB table. No permissions are created.
At least 120 seconds must have elapsed since the latest worker activity.
Only metadata and document hashes are printed; resumes, profiles and letters are never printed.`;

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseArguments(argv);
  if (options.help) return {help: usage};
  const table = options.table ?? process.env.TABLE_NAME;
  if (!table) throw new OperatorError('TABLE_REQUIRED', 'Supply --table or TABLE_NAME.');
  let letterText;
  if (options['letter-file']) {
    if (!isAbsolute(options['letter-file'])) throw new OperatorError('LETTER_PATH_REQUIRED', 'Use an absolute existing provider-letter path.');
    const info = await stat(options['letter-file']);
    if (!info.isFile() || info.size > 64000) throw new OperatorError('INVALID_LETTER_FILE', 'Use a text file no larger than 64 KB.');
    letterText = await readFile(options['letter-file'], 'utf8');
  }
  const store = dependencies.store ?? await DynamoStore.create(table);
  return reconcileGeneration({
    store,
    userSub: options['user-sub'],
    generationId: options['generation-id'],
    apply: options.apply === true,
    resolution: options.resolution,
    evidenceReference: options.evidence,
    operatorReference: options.operator,
    letterText,
    ...(dependencies.now === undefined ? {} : {now: dependencies.now}),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await main();
    console.log(result.help ?? JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      error: error instanceof OperatorError ? error.code : 'OPERATION_FAILED',
      message: error instanceof OperatorError ? error.message : 'Reconciliation failed. Check credentials, target and the existing operational record.',
    }));
    process.exitCode = 1;
  }
}
