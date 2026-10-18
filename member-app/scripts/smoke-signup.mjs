import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { CognitoIdentityProviderClient, SignUpCommand, ConfirmSignUpCommand, InitiateAuthCommand, AdminGetUserCommand, AdminDeleteUserCommand, ForgotPasswordCommand, ConfirmForgotPasswordCommand } from '@aws-sdk/client-cognito-identity-provider';

class SafeError extends Error {}

async function main() {
  if (process.env.ROLECLUE_RUN_EMAIL_SMOKE !== '1') throw new SafeError('Explicit email-smoke opt-in is required.');
  // Launch with tty:true, stty -echo and an EXIT trap restoring echo. Readline
  // terminal:false does not suppress the terminal driver's echo of a code.
  if (!process.stdin.isTTY) throw new SafeError('A writable PTY is required; run with tty:true and terminal echo disabled.');
  const email = process.env.ROLECLUE_TEST_EMAIL?.trim().toLowerCase();
  if (!email || !/^[^\s@]+\+roleclue-qa-[a-z0-9-]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new SafeError('Use a dedicated plus-address on a mailbox you control.');
  const profile = 'proairesis-management', region = 'ap-southeast-2';
  const aws = (...args) => JSON.parse(execFileSync('aws', [...args, '--profile', profile, '--region', region, '--no-cli-pager', '--output', 'json'], {
    encoding: 'utf8', timeout: 45000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  }));
  if (aws('sts', 'get-caller-identity').Account !== '037169690315') throw new SafeError('Unexpected AWS account.');
  const stack = aws('cloudformation', 'describe-stacks', '--stack-name', 'roleclue-member-app').Stacks?.[0];
  if (!stack?.StackId?.startsWith('arn:aws:cloudformation:ap-southeast-2:037169690315:stack/roleclue-member-app/')) throw new SafeError('Unexpected deployment stack.');
  if (stack.StackStatus !== 'CREATE_COMPLETE' && stack.StackStatus !== 'UPDATE_COMPLETE') throw new SafeError('Wait for a completed deployment.');
  const out = Object.fromEntries(stack.Outputs.map(x => [x.OutputKey, x.OutputValue]));
  const api = new URL(out.ApiUrl);
  if (api.protocol !== 'https:' || !/^[a-z0-9]+\.execute-api\.ap-southeast-2\.amazonaws\.com$/.test(api.hostname) || api.username || api.password || api.port || api.pathname !== '/' || api.search || api.hash) throw new SafeError('Unexpected deployment API origin.');
  if (out.SiteUrl !== 'https://app.proairesis.digital') throw new SafeError('Unexpected deployment website.');
  const site = new URL(out.SiteUrl);
  if (!out.CognitoClientId || !out.CognitoUserPoolId?.startsWith('ap-southeast-2_')) throw new SafeError('Cognito stack outputs are missing.');
  process.env.AWS_PROFILE = profile;
  const cognito = new CognitoIdentityProviderClient({ region, maxAttempts: 1 });
  const send = command => cognito.send(command, { abortSignal: AbortSignal.timeout(20000) });
  const newPassword = () => `Qa${randomBytes(24).toString('base64url')}9`;
  const password = newPassword(), ownershipName = `Synthetic Email Acceptance ${randomUUID()}`;
  let aliasWasAbsent = false, signupAttempted = false, created = false, token, subject, cancelled;
  let stage = 'alias-absence preflight', codeTimer, rejectCode, closingInput = false;
  const input = createInterface({ input: process.stdin, terminal: false });
  const prepareCode = () => {
    const promise = new Promise((resolve, reject) => {
      rejectCode = reject;
      input.once('line', value => { clearTimeout(codeTimer); resolve(value.trim()); });
    });
    promise.catch(() => {});
    return promise;
  };
  const firstCode = prepareCode();
  const cancel = message => {
    cancelled ??= new SafeError(message);
    rejectCode(cancelled);
  };
  const interrupt = () => cancel('Signup test interrupted; exact test-account cleanup was requested.');
  const closed = () => { if (!closingInput) cancel('Verification-code input closed before the test finished.'); };
  const inputFailed = () => cancel('Verification-code input failed.');
  input.once('close', closed);
  input.once('error', inputFailed);
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  const checkCancelled = () => { if (cancelled) throw cancelled; };
  const readCode = async (promise, label, delivery) => {
    checkCancelled();
    codeTimer = setTimeout(() => cancel('Verification-code wait expired.'), 180000);
    console.log(JSON.stringify({ stage: label, email, delivery }));
    const code = await promise;
    clearTimeout(codeTimer);
    if (!/^\d{6}$/.test(code)) throw new SafeError('Expected a six-digit code through standard input.');
    checkCancelled();
    return code;
  };
  const findAlias = async () => {
    try { return await send(new AdminGetUserCommand({ UserPoolId: out.CognitoUserPoolId, Username: email })); }
    catch (error) { if (error.name === 'UserNotFoundException') return null; throw error; }
  };
  const request = (path, options = {}) => fetch(new URL(path, site), {
    ...options, redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${token}`, Origin: out.SiteUrl, ...options.headers },
  });
  const verifySignIn = async passwordValue => {
    const signed = await send(new InitiateAuthCommand({ ClientId: out.CognitoClientId, AuthFlow: 'USER_PASSWORD_AUTH', AuthParameters: { USERNAME: email, PASSWORD: passwordValue } }));
    if (!signed.AuthenticationResult?.IdToken) throw new SafeError('Confirmed signup did not return an ID token.');
    token = signed.AuthenticationResult.IdToken;
    checkCancelled();
    const response = await request('/api/me');
    if (response.status !== 200 || (await response.json()).profile?.email !== email) throw new SafeError('Verified signup did not authorize its own account.');
    checkCancelled();
  };
  try {
    if (await findAlias()) throw new SafeError('This exact QA alias already exists. Choose a fresh alias; it was not changed.');
    aliasWasAbsent = true;
    checkCancelled();
    stage = 'signup';
    signupAttempted = true;
    const result = await send(new SignUpCommand({ ClientId: out.CognitoClientId, Username: email, Password: password,
      UserAttributes: [{ Name: 'email', Value: email }, { Name: 'name', Value: ownershipName }] }));
    created = true; subject = result.UserSub;
    stage = 'email verification code';
    const code = await readCode(firstCode, 'awaiting-code', result.CodeDeliveryDetails?.DeliveryMedium);
    stage = 'signup confirmation';
    await send(new ConfirmSignUpCommand({ ClientId: out.CognitoClientId, Username: email, ConfirmationCode: code }));
    checkCancelled();
    stage = 'password sign-in and private API';
    await verifySignIn(password);
    console.log(JSON.stringify({ check: 'delivered-email-confirmation-signin-private-api', passed: true }));
    if (process.env.ROLECLUE_TEST_PASSWORD_RECOVERY === '1') {
      checkCancelled();
      stage = 'password-recovery email';
      const resetCode = prepareCode();
      const recovery = await send(new ForgotPasswordCommand({ ClientId: out.CognitoClientId, Username: email }));
      stage = 'password-recovery code';
      const code = await readCode(resetCode, 'awaiting-reset-code', recovery.CodeDeliveryDetails?.DeliveryMedium);
      const replacement = newPassword();
      stage = 'password reset confirmation';
      await send(new ConfirmForgotPasswordCommand({ ClientId: out.CognitoClientId, Username: email, ConfirmationCode: code, Password: replacement }));
      checkCancelled();
      stage = 'replacement-password sign-in and private API';
      await verifySignIn(replacement);
      console.log(JSON.stringify({ check: 'delivered-recovery-email-reset-signin-private-api', passed: true }));
    }
  } catch (error) {
    if (error instanceof SafeError) throw error;
    throw new SafeError(`Email signup test failed during ${stage}.`);
  } finally {
    clearTimeout(codeTimer);
    closingInput = true;
    input.close();
    try {
      // Reconcile a lost SignUp response only when the absent alias now has
      // this run's random marker. Never delete an unrelated UsernameExists.
      if (signupAttempted && aliasWasAbsent && (!created || !subject)) {
        const recovered = await findAlias();
        if (recovered) {
          const attributes = Object.fromEntries((recovered.UserAttributes ?? []).map(x => [x.Name, x.Value]));
          if (attributes.email !== email || attributes.name !== ownershipName || !/^[a-f0-9-]{36}$/i.test(attributes.sub ?? '')) throw new SafeError('The QA alias does not match this run; no identity was deleted.');
          created = true; subject = attributes.sub;
        }
      }
      if (created && token) {
        let removed = false;
        for (let attempt = 0; attempt < 2 && !removed; attempt++) {
          try {
            const response = await request('/api/account', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmation: 'DELETE' }) });
            if (!response.ok || (await response.json()).deleted !== true) throw new SafeError(`Test account cleanup requires attention: HTTP ${response.status}`);
            removed = true;
          } catch (error) { if (attempt === 1) throw error; }
        }
        created = false;
        console.log(JSON.stringify({ check: 'email-test-account-removed', passed: true }));
      }
      if (created) {
        // Without a token this script has made no app-data writes. Delete only
        // its known subject, never a broad alias or user search.
        if (!/^[a-f0-9-]{36}$/i.test(subject ?? '')) throw new SafeError('The test identity subject is unavailable; manual reconciliation is required.');
        try { await send(new AdminDeleteUserCommand({ UserPoolId: out.CognitoUserPoolId, Username: subject })); }
        catch (error) { if (error.name !== 'UserNotFoundException') throw error; }
        console.log(JSON.stringify({ check: 'unconfirmed-test-identity-removed', passed: true }));
      }
    } catch {
      console.error(JSON.stringify({ check: 'email-test-cleanup', passed: false, cleanupRequired: { email, subject: subject ?? null }, message: 'Reconcile this exact QA identity; cleanup could not be confirmed.' }));
      throw new SafeError('Email test cleanup requires operator attention.');
    } finally {
      token = undefined;
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
      cognito.destroy();
    }
  }
  checkCancelled();
}

main().catch(error => {
  console.error(JSON.stringify({ check: 'email-signup-test', passed: false, message: error instanceof SafeError ? error.message : 'Email signup test failed during AWS preflight.' }));
  process.exitCode = 1;
});
