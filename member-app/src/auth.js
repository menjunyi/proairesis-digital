import { clearAccountBrowserState } from "./guest-state.js";

const SESSION_KEY = "roleclue.session.v1";
const OAUTH_KEY = "roleclue.oauth.v1";
let sessionEpoch = 0;
let refreshRequest = null;

function sessionChanged() {
  const error = new Error("Your session changed. Please sign in again.");
  error.code = "SESSION_CHANGED";
  return error;
}

export function captureSessionGuard() {
  const expectedEpoch = sessionEpoch;
  return () => {
    if (expectedEpoch !== sessionEpoch || !readSession())
      throw sessionChanged();
  };
}

export function readSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function clearSession() {
  sessionEpoch += 1;
  refreshRequest = null;
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(OAUTH_KEY);
  for (const key of Object.keys(sessionStorage)) {
    if (key.startsWith("roleclue.generation.")) sessionStorage.removeItem(key);
  }
}

function saveSession(value, expectedEpoch = sessionEpoch) {
  if (expectedEpoch !== sessionEpoch) throw sessionChanged();
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
  return value;
}

async function cognito(config, action, data) {
  if (!config.cognitoRegion || !config.cognitoClientId)
    throw new Error(
      "Account access is not configured yet. Please try again later.",
    );
  const response = await fetch(
    `https://cognito-idp.${config.cognitoRegion}.amazonaws.com/`,
    {
      method: "POST",
      signal: AbortSignal.timeout(45000),
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": `AWSCognitoIdentityProviderService.${action}`,
      },
      body: JSON.stringify(data),
    },
  );
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(
      result.message || "We could not complete that account action.",
    );
    error.code = String(result.__type || "")
      .split("#")
      .pop();
    throw error;
  }
  return result;
}

function authSession(result, email, previousRefreshToken, expectedEpoch) {
  if (!result.AuthenticationResult)
    throw new Error(
      "This account needs an additional sign-in step. Contact RoleClue support to complete setup.",
    );
  const value = result.AuthenticationResult;
  return saveSession(
    {
      email,
      idToken: value.IdToken,
      accessToken: value.AccessToken,
      refreshToken: value.RefreshToken || previousRefreshToken,
      expiresAt: Date.now() + value.ExpiresIn * 1000,
    },
    expectedEpoch,
  );
}

export async function signIn(config, email, password) {
  const expectedEpoch = ++sessionEpoch;
  refreshRequest = null;
  const result = await cognito(config, "InitiateAuth", {
    AuthFlow: "USER_PASSWORD_AUTH",
    ClientId: config.cognitoClientId,
    AuthParameters: { USERNAME: email, PASSWORD: password },
  });
  return authSession(result, email, undefined, expectedEpoch);
}

export function startDemo(config) {
  if (config.mode !== "demo")
    throw new Error("Demo accounts are unavailable in this environment.");
  clearSession();
  return saveSession({
    email: "alex@example.test",
    idToken: "demo",
    demo: true,
    expiresAt: Date.now() + 86400000,
  });
}

export async function signUp(config, email, password, name) {
  return cognito(config, "SignUp", {
    ClientId: config.cognitoClientId,
    Username: email,
    Password: password,
    UserAttributes: [
      { Name: "email", Value: email },
      ...(name ? [{ Name: "name", Value: name }] : []),
    ],
  });
}

function encode(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomValue(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return encode(bytes);
}

function oauthDomain(config) {
  const value = String(config.cognitoDomain || "").replace(/\/$/, "");
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(value))
    throw new Error("Google sign-in is not configured yet. Continue with email.");
  return value;
}

export async function startHostedSignIn(config, provider = "Google") {
  if (provider !== "Google") throw new Error("Choose a supported sign-in provider.");
  const verifier = randomValue(48);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  const state = randomValue(32);
  const redirectUri = config.oauthRedirectUri || `${window.location.origin}/`;
  sessionStorage.setItem(
    OAUTH_KEY,
    JSON.stringify({ state, verifier, redirectUri, createdAt: Date.now() }),
  );
  const query = new URLSearchParams({
    client_id: config.cognitoClientId,
    response_type: "code",
    scope: "openid email profile",
    redirect_uri: redirectUri,
    identity_provider: provider,
    code_challenge_method: "S256",
    code_challenge: encode(digest),
    state,
  });
  window.location.assign(`${oauthDomain(config)}/oauth2/authorize?${query}`);
}

function tokenEmail(idToken) {
  try {
    const payload = idToken.split(".")[1];
    const normal = payload.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(normal.padEnd(Math.ceil(normal.length / 4) * 4, "="))).email;
  } catch {
    return "";
  }
}

export async function completeHostedSignIn(config) {
  const query = new URLSearchParams(window.location.search);
  const code = query.get("code");
  const state = query.get("state");
  const oauthError = query.get("error");
  if (!code && !oauthError) return null;
  const expectedEpoch = ++sessionEpoch;
  refreshRequest = null;
  let pending;
  try {
    pending = JSON.parse(sessionStorage.getItem(OAUTH_KEY) || "null");
  } catch {
    pending = null;
  }
  sessionStorage.removeItem(OAUTH_KEY);
  if (oauthError)
    throw new Error(
      query.get("error_description") || "Google sign-in was cancelled.",
    );
  if (
    !pending ||
    pending.state !== state ||
    Date.now() - pending.createdAt > 10 * 60 * 1000
  )
    throw new Error("This sign-in link expired or did not match this browser. Try again.");
  const response = await fetch(`${oauthDomain(config)}/oauth2/token`, {
    method: "POST",
    signal: AbortSignal.timeout(45000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.cognitoClientId,
      code,
      redirect_uri: pending.redirectUri,
      code_verifier: pending.verifier,
    }),
  });
  const result = await response.json();
  if (!response.ok || !result.id_token)
    throw new Error("Google sign-in could not be completed. Continue with email or try again.");
  const email = tokenEmail(result.id_token);
  if (!email) throw new Error("Google did not return a verified email address.");
  const value = saveSession(
    {
      email,
      idToken: result.id_token,
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      expiresAt: Date.now() + Number(result.expires_in || 3600) * 1000,
      provider: "Google",
    },
    expectedEpoch,
  );
  window.history.replaceState({}, "", `${window.location.pathname}${window.location.hash || ""}`);
  return value;
}

export const confirmSignUp = (config, email, code) =>
  cognito(config, "ConfirmSignUp", {
    ClientId: config.cognitoClientId,
    Username: email,
    ConfirmationCode: code,
  });
export const resendCode = (config, email) =>
  cognito(config, "ResendConfirmationCode", {
    ClientId: config.cognitoClientId,
    Username: email,
  });
export const forgotPassword = (config, email) =>
  cognito(config, "ForgotPassword", {
    ClientId: config.cognitoClientId,
    Username: email,
  });
export const resetPassword = (config, email, code, password) =>
  cognito(config, "ConfirmForgotPassword", {
    ClientId: config.cognitoClientId,
    Username: email,
    ConfirmationCode: code,
    Password: password,
  });

export async function getToken(config) {
  const session = readSession();
  if (!session) throw new Error("Please sign in to continue.");
  if (session.demo) {
    if (config.mode !== "demo") {
      clearSession();
      throw new Error("Please sign in to your account.");
    }
    return session.idToken;
  }
  if (session.expiresAt > Date.now() + 60000) return session.idToken;
  if (!session.refreshToken) {
    clearSession();
    throw new Error("Your session has expired. Please sign in again.");
  }
  const expectedEpoch = sessionEpoch;
  if (refreshRequest?.epoch === expectedEpoch) return refreshRequest.promise;
  const promise = (async () => {
    try {
      const result = await cognito(config, "InitiateAuth", {
        ClientId: config.cognitoClientId,
        AuthFlow: "REFRESH_TOKEN_AUTH",
        AuthParameters: { REFRESH_TOKEN: session.refreshToken },
      });
      return authSession(
        result,
        session.email,
        session.refreshToken,
        expectedEpoch,
      ).idToken;
    } catch (error) {
      if (sessionEpoch === expectedEpoch) clearSession();
      throw error;
    } finally {
      if (refreshRequest?.promise === promise) refreshRequest = null;
    }
  })();
  refreshRequest = { epoch: expectedEpoch, promise };
  return promise;
}

export async function signOut(config, { preserveGuestState = false } = {}) {
  const session = readSession();
  clearSession();
  clearAccountBrowserState({ preserveGuestState });
  if (session?.accessToken && !session.demo) {
    try {
      await cognito(config, "GlobalSignOut", {
        AccessToken: session.accessToken,
      });
    } catch {
      /* The local session is already cleared, including on a network failure. */
    }
  }
}
