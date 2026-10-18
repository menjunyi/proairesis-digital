import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const releasePathspecs = [
  ':/.github/workflows/member-app-release.yml',
  ':/member-app/.env.example', ':/member-app/.gitignore', ':/member-app/README.md',
  ':/member-app/contract.json', ':/member-app/index.html', ':/member-app/package-lock.json',
  ':/member-app/package.json', ':/member-app/vite.config.mjs',
  ':/member-app/infra', ':/member-app/public', ':/member-app/scripts',
  ':/member-app/server', ':/member-app/src', ':/member-app/tests',
];

export function productionConfig(env = process.env) {
  const config = {
    apiBaseUrl: '', cognitoRegion: 'ap-southeast-2',
    cognitoClientId: env.ROLECLUE_COGNITO_CLIENT_ID || '',
    cognitoDomain: env.ROLECLUE_COGNITO_DOMAIN || '',
    oauthRedirectUri: env.ROLECLUE_OAUTH_REDIRECT_URI || '',
    googleSignInEnabled: env.ROLECLUE_GOOGLE_SIGN_IN_ENABLED === 'true',
    mode: 'production', marketingUrl: 'https://proairesis.digital',
    capabilities: {
      jobImport: true,
      recommendations: env.ROLECLUE_RECOMMENDATIONS_ENABLED === 'true',
      guestDiscovery: env.ROLECLUE_GUEST_DISCOVERY_ENABLED === 'true',
      coverLetters: env.ROLECLUE_COVER_LETTERS_ENABLED === 'true',
      billing: env.ROLECLUE_BILLING_ENABLED === 'true',
    },
  };
  if (config.googleSignInEnabled) {
    if (!/^https:\/\/[a-z0-9.-]+$/i.test(config.cognitoDomain)) throw new Error('Set the public Cognito hosted UI domain before enabling Google sign-in.');
    if (!/^https:\/\/[^\s]+$/i.test(config.oauthRedirectUri)) throw new Error('Set the HTTPS OAuth redirect URI before enabling Google sign-in.');
  }
  config.betaNotice = [
    config.capabilities.recommendations
      ? 'RoleClue searches current Australian technology listings and shows only high-fit results.'
      : 'Bring a job from SEEK, LinkedIn or an employer to review its fit.',
    ...(!config.capabilities.recommendations ? ['Automatic job discovery is not included in this release.'] : []),
    ...(config.capabilities.recommendations && !config.capabilities.guestDiscovery
      ? ['Create an account or sign in to use current job recommendations.']
      : []),
    ...(!config.capabilities.billing ? ['Paid subscriptions are not currently available.'] : []),
  ].join(' ');
  if (!/^[a-z0-9]{10,128}$/.test(config.cognitoClientId)) throw new Error('Set the deployed public Cognito client ID before preparing a release.');
  return config;
}

export async function prepareRelease() {
  const config = productionConfig();
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const appDirectory = resolve(scriptDirectory, '..');
  const repository = execFileSync('git', ['rev-parse', '--show-toplevel'], {cwd: appDirectory, encoding: 'utf8'}).trim();
  const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repository, encoding: 'utf8'}).trim();
  const dirty = execFileSync('git', ['status', '--porcelain', '--', ...releasePathspecs], {cwd: repository, encoding: 'utf8'}).trim();
  if (!/^[a-f0-9]{40}$/.test(sourceRevision) || dirty) throw new Error('Commit the complete member-app release source before preparing a production release.');
  if (!execFileSync('git', ['ls-files', ':/member-app/server/handler.mjs'], {cwd: repository, encoding: 'utf8'}).trim()) throw new Error('The member app is not tracked in source control.');
  execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
  const configJson = JSON.stringify(config);
  await writeFile('dist/config.json', configJson);
  await mkdir('build', { recursive: true });
  const lambdaSha256 = (await readFile('build/lambda.sha256', 'utf8')).trim();
  const indexSha256 = createHash('sha256').update(await readFile('dist/index.html')).digest('hex');
  const templateSha256 = createHash('sha256').update(await readFile('build/app.template.json')).digest('hex');
  const releaseId = createHash('sha256').update(JSON.stringify({sourceRevision,lambdaSha256,indexSha256,templateSha256,config})).digest('hex');
  const manifest = { version: 2, releaseId, sourceRevision, createdAt: new Date().toISOString(), mode: config.mode, lambdaSha256, indexSha256, templateSha256 };
  await writeFile('dist/release.json', JSON.stringify(manifest));
  await rm('build/site.zip', {force: true});
  execFileSync('zip', ['-q', '-r', resolve('build/site.zip'), '.'], {cwd: resolve('dist')});
  console.log(JSON.stringify({ prepared: true, manifest }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await prepareRelease();
