// Copyright (C) 2026-2026 Huawei Technologies Co., Ltd
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * HUAWEI ID sign-in callback logic, kept independent of where it runs.
 *
 * HUAWEI sends the browser back to the `redirect_uri` registered in AppGallery
 * Connect with `?code=…&state=…`. `completeSignIn` trades the one-time code for
 * an ID token, reads the profile claims, and builds the redirect to the web app
 * with the identity in the URL fragment. Fragments never reach a server, and the
 * app re-checks `state` against the value it stored before leaving.
 *
 * The exchange proves itself with PKCE: the client generates a code_verifier,
 * sends only its SHA-256 hash to HUAWEI, and hands the verifier to this service
 * in a cookie (cookies ignore ports, so the web app's origin and this callback
 * port share it). There is no client secret anywhere, which is what makes the
 * desktop build shippable: nothing long-lived lands on a user's machine, and
 * this callback can run on the loopback interface of that same machine.
 *
 * Two entry points share it:
 *   server.cjs  local HTTP server on 127.0.0.1:8787 — the current setup, whose
 *               URL is registered directly as the AppGallery callback
 *   handler()   gateway shape (event in, `{statusCode, headers, body}` out), so
 *               the same logic survives a move behind an API gateway
 *
 * Plain CommonJS so a cloud console's default `index.js` runs it as-is and so
 * `node --test` can require it; the file is named `.cjs` here because this
 * repository marks packages as ES modules.
 *
 * Environment:
 *   HUAWEI_CLIENT_ID      OAuth client id from AppGallery Connect (required)
 *   WEB_ORIGIN            where the browser goes back, e.g. https://app.example.com (required)
 *   LOGIN_PATH            sign-in screen path (default /login)
 *   HUAWEI_REDIRECT_URI   registered callback URL; only `handler()` can fall
 *                         back to deriving it from the incoming request
 *   HUAWEI_TOKEN_ENDPOINT token endpoint override (tests only)
 */

"use strict";

const DEFAULT_TOKEN_ENDPOINT = "https://oauth-login.cloud.huawei.com/oauth2/v3/token";

/** Cookie carrying the PKCE verifier from the web app to this service. */
const PKCE_COOKIE = "sciencediscovery-pkce";

/** Failure that maps to one HTTP status and one machine-readable code. */
class CallbackError extends Error {
  constructor(status, code, detail) {
    super(detail);
    this.name = "CallbackError";
    this.status = status;
    this.code = code;
  }
}

/** Reads and validates the deployment settings. */
function readConfig(env = process.env) {
  const clientId = (env.HUAWEI_CLIENT_ID ?? "").trim();
  const webOrigin = (env.WEB_ORIGIN ?? "").trim().replace(/\/+$/, "");
  const missing = [];
  if (!clientId) missing.push("HUAWEI_CLIENT_ID");
  if (!webOrigin) missing.push("WEB_ORIGIN");
  if (missing.length > 0) throw new CallbackError(500, "not_configured", `missing ${missing.join(", ")}`);

  const loginPath = (env.LOGIN_PATH ?? "/login").trim() || "/login";
  return {
    clientId,
    webOrigin,
    loginPath: loginPath.startsWith("/") ? loginPath : `/${loginPath}`,
    tokenEndpoint: (env.HUAWEI_TOKEN_ENDPOINT ?? "").trim() || DEFAULT_TOKEN_ENDPOINT,
    redirectUri: (env.HUAWEI_REDIRECT_URI ?? "").trim() || undefined,
  };
}

/** Reads the JWT payload. The token arrived over TLS straight from HUAWEI. */
function decodeIdToken(idToken) {
  const segments = typeof idToken === "string" ? idToken.split(".") : [];
  if (segments.length < 2) throw new CallbackError(502, "id_token_malformed", "ID token is not a JWT");
  let claims;
  try {
    claims = JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8"));
  } catch {
    throw new CallbackError(502, "id_token_malformed", "ID token payload is not JSON");
  }
  if (claims === null || typeof claims !== "object") {
    throw new CallbackError(502, "id_token_malformed", "ID token payload is not an object");
  }
  return claims;
}

function pickText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Keeps only the three profile fields the client stores. */
function toIdentity(claims) {
  const openId = pickText(claims.openid) ?? pickText(claims.sub);
  if (!openId) throw new CallbackError(502, "id_token_without_openid", "ID token carries no openid");
  const identity = { openId };
  const displayName = pickText(claims.display_name) ?? pickText(claims.nickname);
  const email = pickText(claims.email);
  if (displayName) identity.displayName = displayName;
  if (email) identity.email = email;
  return identity;
}

/** Fragment payload; base64url keeps it inside any URL grammar. */
function encodeResult(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/**
 * Completes the round trip and returns the redirect to issue.
 * `fetchImpl` is injectable so the exchange can be tested without HUAWEI.
 */
async function completeSignIn({ query, env = process.env, fetchImpl = fetch, redirectUri, codeVerifier }) {
  const config = readConfig(env);
  const back = (fragment) => `${config.webOrigin}${config.loginPath}#${fragment}`;

  // The user cancelled, or HUAWEI rejected the request before issuing a code.
  const denial = query.get("error");
  if (denial) return { status: 302, location: back(new URLSearchParams({ error: denial }).toString()) };

  const code = (query.get("code") ?? "").trim();
  if (!code) throw new CallbackError(400, "missing_code", "HUAWEI redirect carried no authorization code");
  const state = (query.get("state") ?? "").trim();
  if (!codeVerifier) {
    // Without it there is no proof at all: PKCE replaced the shared secret, so
    // an unreadable cookie means the callback landed on a different host.
    throw new CallbackError(400, "missing_code_verifier", `request carried no ${PKCE_COOKIE} cookie`);
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: config.clientId,
    // The verifier is the proof: HUAWEI compares it against the hash the
    // authorize call carried, so no shared secret has to exist.
    code_verifier: codeVerifier,
  });
  // HUAWEI rejects the exchange unless the authorize redirect_uri is repeated.
  const callbackUri = redirectUri || config.redirectUri;
  if (callbackUri) body.set("redirect_uri", callbackUri);

  const response = await fetchImpl(config.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new CallbackError(502, "token_response_unreadable", `token endpoint returned ${response.status}`);
  }
  const idToken = payload && typeof payload === "object" ? payload.id_token : undefined;
  if (!response.ok || typeof idToken !== "string") {
    const detail = (payload && typeof payload === "object" && (payload.error_description ?? payload.error)) || `HTTP ${response.status}`;
    throw new CallbackError(502, "token_exchange_failed", String(detail));
  }

  const identity = toIdentity(decodeIdToken(idToken));
  return { status: 302, location: back(new URLSearchParams({ auth: encodeResult({ state, ...identity }) }).toString()) };
}

/** Case-insensitive header lookup; gateways differ on capitalisation. */
function readHeader(headers, name) {
  if (!headers || typeof headers !== "object") return undefined;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted && typeof value === "string") return value;
  }
  return undefined;
}

/** Reads one cookie from the request, when the gateway forwards the header. */
function readCookie(headers, name) {
  const header = readHeader(headers, "cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim() || undefined;
  }
  return undefined;
}

/** Expires the verifier cookie: the code it belongs to is single-use anyway. */
const CLEAR_PKCE_COOKIE = `${PKCE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;

function readQuery(event) {
  const raw = typeof event?.rawQueryString === "string" ? event.rawQueryString : "";
  if (raw) return new URLSearchParams(raw);
  const parameters = event?.queryStringParameters;
  if (parameters && typeof parameters === "object") {
    const entries = Object.entries(parameters).filter(([, value]) => typeof value === "string");
    if (entries.length > 0) return new URLSearchParams(entries);
  }
  // HTTP 函数 deployments may only carry the query string on the path.
  const path = [event?.rawPath, event?.path].find((value) => typeof value === "string" && value.includes("?"));
  if (path) return new URLSearchParams(path.slice(path.indexOf("?") + 1));
  return new URLSearchParams();
}

/**
 * The URL HUAWEI redirected to. Reading it from the incoming request guarantees
 * it matches the authorize call; `HUAWEI_REDIRECT_URI` wins when set.
 */
function readRedirectUri(event, config) {
  if (config.redirectUri) return config.redirectUri;
  const headers = event?.headers && typeof event.headers === "object" ? event.headers : {};
  const host = pickText(headers.host) ?? pickText(headers.Host);
  const path = [event?.path, event?.rawPath].find((value) => typeof value === "string" && value);
  if (!host || !path) return undefined;
  const cleanPath = path.split("?")[0];
  return `https://${host}${cleanPath.startsWith("/") ? cleanPath : `/${cleanPath}`}`;
}

function renderFailure(error) {
  const status = error instanceof CallbackError ? error.status : 500;
  const code = error instanceof CallbackError ? error.code : "internal_error";
  console.error("huawei sign-in failed", code, error instanceof Error ? error.message : error);
  return {
    statusCode: status,
    isBase64Encoded: false,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify({ error: code, detail: error instanceof Error ? error.message : String(error) }),
  };
}

/** Gateway-shaped entry point: event in, response object out. */
async function handler(event) {
  try {
    const result = await completeSignIn({
      query: readQuery(event),
      redirectUri: readRedirectUri(event, readConfig()),
      codeVerifier: readCookie(event?.headers, PKCE_COOKIE),
    });
    return {
      statusCode: result.status,
      isBase64Encoded: false,
      headers: {
        location: result.location,
        "cache-control": "no-store",
        "set-cookie": CLEAR_PKCE_COOKIE,
      },
      body: "",
    };
  } catch (error) {
    return renderFailure(error);
  }
}

module.exports = {
  CallbackError,
  PKCE_COOKIE,
  CLEAR_PKCE_COOKIE,
  readConfig,
  decodeIdToken,
  toIdentity,
  encodeResult,
  completeSignIn,
  readCookie,
  readRedirectUri,
  handler,
};
