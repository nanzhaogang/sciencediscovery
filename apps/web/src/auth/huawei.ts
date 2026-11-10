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
 * HUAWEI ID sign-in, scheme A: the browser leaves for the HUAWEI ID page,
 * the user signs in there with their phone number and the code HUAWEI sends,
 * and HUAWEI redirects to the callback service with an authorization code. The
 * phone number and the SMS never touch this app.
 *
 * `redirect_uri` is the callback service, not this app. It exchanges the code,
 * reads the profile, and sends the browser back to `/login#auth=…`. The identity
 * therefore travels in the URL fragment, which never reaches a server, and
 * `state` comes back inside it so the value stored before leaving can be matched.
 *
 * The exchange is PKCE, so the callback service needs no secret: this module
 * generates a `code_verifier`, sends only its SHA-256 hash to HUAWEI, and passes
 * the verifier itself to the callback service in a cookie. Cookies are scoped to
 * the host rather than the port, so the callback port on the same machine reads
 * what this app wrote.
 *
 * Builds without `VITE_HUAWEI_CLIENT_ID` and `VITE_HUAWEI_REDIRECT_URI` have no
 * HUAWEI app to talk to, so `previewSignIn` fabricates an identity and the UI
 * says so.
 */

export const HUAWEI_AUTHORIZE_ENDPOINT = "https://oauth-login.cloud.huawei.com/oauth2/v3/authorize";
export const HUAWEI_SCOPE = "openid profile email";

const STATE_STORAGE_KEY = "sciencediscovery-auth-state";

/** Cookie the callback service reads the PKCE verifier from. */
export const PKCE_COOKIE = "sciencediscovery-pkce";
const PKCE_COOKIE_MAX_AGE_SECONDS = 600;

/** The subset of the HUAWEI ID profile this app keeps. */
export interface HuaweiIdentity {
  openId: string;
  displayName?: string;
  email?: string;
}

export interface HuaweiConfig {
  clientId: string;
  redirectUri: string;
}

/** What the callback service hands back in the fragment. */
export interface AuthorizeResult {
  state: string;
  identity: HuaweiIdentity;
}

/** Returns the configured HUAWEI app, or `undefined` when the build has none. */
export function readHuaweiConfig(): HuaweiConfig | undefined {
  const clientId = (import.meta.env.VITE_HUAWEI_CLIENT_ID ?? "").trim();
  const redirectUri = (import.meta.env.VITE_HUAWEI_REDIRECT_URI ?? "").trim();
  if (!clientId || !redirectUri) return undefined;
  return { clientId, redirectUri };
}

export function buildHuaweiAuthorizeUrl({
  clientId,
  redirectUri,
  state,
  codeChallenge,
}: HuaweiConfig & { state: string; codeChallenge: string }): string {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: HUAWEI_SCOPE,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${HUAWEI_AUTHORIZE_ENDPOINT}?${query.toString()}`;
}

/** Random `state` value, kept in sessionStorage so the callback can be matched. */
export function createAuthorizeState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Unpadded base64url, the only encoding PKCE accepts for both values. */
function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 256 bits of randomness, which lands on 43 base64url characters. */
export function createCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

/** `S256`, the only challenge method HUAWEI advertises. */
export async function createCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return encodeBase64Url(new Uint8Array(digest));
}

/** Hands the verifier to the callback service, which shares this cookie jar. */
export function rememberCodeVerifier(verifier: string): void {
  document.cookie = `${PKCE_COOKIE}=${verifier}; Path=/; Max-Age=${PKCE_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}

export function rememberAuthorizeState(state: string): void {
  try {
    window.sessionStorage.setItem(STATE_STORAGE_KEY, state);
  } catch {
    // Private-mode storage failures only weaken CSRF protection; the callback
    // still verifies the code with the server.
  }
}

/** Reads and clears the stored `state`; a second callback cannot reuse it. */
export function consumeAuthorizeState(): string | undefined {
  try {
    const state = window.sessionStorage.getItem(STATE_STORAGE_KEY) ?? undefined;
    window.sessionStorage.removeItem(STATE_STORAGE_KEY);
    return state;
  } catch {
    return undefined;
  }
}

/** Reads the base64url text the callback service put in the fragment. */
function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

/** Reads `#auth=…`, the identity the callback service verified for us. */
export function readAuthorizeResult(hash: string): AuthorizeResult | undefined {
  const encoded = new URLSearchParams(hash.replace(/^#/, "")).get("auth");
  if (!encoded) return undefined;
  try {
    const payload = JSON.parse(decodeBase64Url(encoded)) as Record<string, unknown>;
    const openId = typeof payload.openId === "string" ? payload.openId : "";
    if (!openId) return undefined;
    return {
      state: typeof payload.state === "string" ? payload.state : "",
      identity: {
        openId,
        displayName: typeof payload.displayName === "string" ? payload.displayName : undefined,
        email: typeof payload.email === "string" ? payload.email : undefined,
      },
    };
  } catch {
    return undefined;
  }
}

/** True when the callback service reported a refusal as `#error=…`. */
export function readAuthorizeFailure(hash: string): boolean {
  return Boolean(new URLSearchParams(hash.replace(/^#/, "")).get("error"));
}

/** Stable, non-reversible stand-in for an `openid` in builds without a HUAWEI app. */
function stubOpenId(seed: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `preview-${hash.toString(16).padStart(8, "0")}`;
}

/**
 * Offline stand-in for the whole redirect round-trip. The identity carries no
 * name or email, so the UI falls back to a generic label.
 */
export function previewSignIn(delayMs = 900): Promise<HuaweiIdentity> {
  return new Promise((resolve) => {
    setTimeout(() => resolve({ openId: stubOpenId(navigator.userAgent) }), delayMs);
  });
}
