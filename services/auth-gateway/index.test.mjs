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

import assert from "node:assert/strict";
import test from "node:test";

import gateway from "./index.cjs";

const { CallbackError, PKCE_COOKIE, completeSignIn, encodeResult, handler, readConfig, readCookie } = gateway;

const ENV = {
  HUAWEI_CLIENT_ID: "client-from-agc",
  WEB_ORIGIN: "https://app.example.com/",
};

/** Stands in for the value the browser keeps in the PKCE cookie. */
const VERIFIER = "verifier-from-browser";

function idToken(claims) {
  return `header.${Buffer.from(JSON.stringify(claims), "utf8").toString("base64url")}.signature`;
}

function fakeFetch({ status = 200, body }) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  };
  impl.calls = calls;
  return impl;
}

function readResult(location) {
  const encoded = new URL(location).hash.replace(/^#/, "");
  const raw = new URLSearchParams(encoded).get("auth");
  return JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
}

test("readConfig reports every missing required setting", () => {
  assert.throws(() => readConfig({}), (error) => {
    assert.ok(error instanceof CallbackError);
    assert.equal(error.code, "not_configured");
    assert.match(error.message, /HUAWEI_CLIENT_ID/);
    assert.match(error.message, /WEB_ORIGIN/);
    return true;
  });
});

test("readConfig normalises the trailing slash on the web origin", () => {
  const config = readConfig(ENV);
  assert.equal(config.webOrigin, "https://app.example.com");
  assert.equal(config.loginPath, "/login");
});

test("a verified code becomes a fragment redirect carrying the identity", async () => {
  const fetchImpl = fakeFetch({
    body: { id_token: idToken({ openid: "openid-1", display_name: "Ada", email: "ada@example.com" }) },
  });

  const result = await completeSignIn({
    query: new URLSearchParams({ code: "one-time-code", state: "state-123" }),
    env: ENV,
    codeVerifier: VERIFIER,
    fetchImpl,
  });

  assert.equal(result.status, 302);
  assert.ok(result.location.startsWith("https://app.example.com/login#auth="));
  assert.deepEqual(readResult(result.location), {
    state: "state-123",
    openId: "openid-1",
    displayName: "Ada",
    email: "ada@example.com",
  });

  const [call] = fetchImpl.calls;
  assert.equal(call.url, "https://oauth-login.cloud.huawei.com/oauth2/v3/token");
  const body = new URLSearchParams(call.init.body);
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("code"), "one-time-code");
  assert.equal(body.get("client_id"), "client-from-agc");
  assert.equal(body.get("code_verifier"), VERIFIER);
  assert.equal(body.get("client_secret"), null);
});

test("a profile without a name or email still yields an identity", async () => {
  const fetchImpl = fakeFetch({ body: { id_token: idToken({ sub: "sub-9" }) } });
  const result = await completeSignIn({
    query: new URLSearchParams({ code: "c", state: "s" }),
    env: ENV,
    codeVerifier: VERIFIER,
    fetchImpl,
  });
  assert.deepEqual(readResult(result.location), { state: "s", openId: "sub-9" });
});

test("the exchange repeats the redirect_uri the authorize call used", async () => {
  const fetchImpl = fakeFetch({ body: { id_token: idToken({ openid: "openid-2" }) } });
  const result = await completeSignIn({
    query: new URLSearchParams({ code: "pkce-code", state: "s" }),
    env: ENV,
    redirectUri: "http://127.0.0.1:8787/callback",
    codeVerifier: VERIFIER,
    fetchImpl,
  });

  assert.deepEqual(readResult(result.location), { state: "s", openId: "openid-2" });
  const body = new URLSearchParams(fetchImpl.calls[0].init.body);
  assert.equal(body.get("code_verifier"), VERIFIER);
  assert.equal(body.get("redirect_uri"), "http://127.0.0.1:8787/callback");
});

test("without a verifier the exchange is refused before any request", async () => {
  const fetchImpl = fakeFetch({ body: {} });
  await assert.rejects(
    completeSignIn({
      query: new URLSearchParams({ code: "c", state: "s" }),
      env: ENV,
      fetchImpl,
    }),
    (error) => error instanceof CallbackError && error.code === "missing_code_verifier",
  );
  assert.equal(fetchImpl.calls.length, 0);
});

test("the verifier is read from the cookie header next to other cookies", () => {
  assert.equal(readCookie({ Cookie: `a=1; ${PKCE_COOKIE}=v1; b=2` }, PKCE_COOKIE), "v1");
  assert.equal(readCookie({ cookie: `${PKCE_COOKIE}=v2` }, PKCE_COOKIE), "v2");
  assert.equal(readCookie({}, PKCE_COOKIE), undefined);
});

test("HUAWEI declining the request is sent back as a fragment error", async () => {
  const result = await completeSignIn({
    query: new URLSearchParams({ error: "access_denied", state: "s" }),
    env: ENV,
    fetchImpl: fakeFetch({ body: {} }),
  });
  assert.equal(result.location, "https://app.example.com/login#error=access_denied");
});

test("a redirect without a code fails with 400", async () => {
  await assert.rejects(
    completeSignIn({ query: new URLSearchParams({ state: "s" }), env: ENV, fetchImpl: fakeFetch({ body: {} }) }),
    (error) => error instanceof CallbackError && error.status === 400 && error.code === "missing_code",
  );
});

test("a token endpoint rejection surfaces HUAWEI's reason", async () => {
  const fetchImpl = fakeFetch({ status: 400, body: { error: "invalid_grant", error_description: "code expired" } });
  await assert.rejects(
    completeSignIn({ query: new URLSearchParams({ code: "stale" }), env: ENV, codeVerifier: VERIFIER, fetchImpl }),
    (error) => error instanceof CallbackError && error.code === "token_exchange_failed" && /code expired/.test(error.message),
  );
});

test("an unreadable token response is reported as such", async () => {
  const fetchImpl = async () => new Response("<html>gateway error</html>", { status: 502 });
  await assert.rejects(
    completeSignIn({ query: new URLSearchParams({ code: "c" }), env: ENV, codeVerifier: VERIFIER, fetchImpl }),
    (error) => error instanceof CallbackError && error.code === "token_response_unreadable",
  );
});

test("an ID token without openid is rejected", async () => {
  const fetchImpl = fakeFetch({ body: { id_token: idToken({ display_name: "No Subject" }) } });
  await assert.rejects(
    completeSignIn({ query: new URLSearchParams({ code: "c" }), env: ENV, codeVerifier: VERIFIER, fetchImpl }),
    (error) => error instanceof CallbackError && error.code === "id_token_without_openid",
  );
});

test("decodeIdToken rejects a value that is not a JWT", async () => {
  const fetchImpl = fakeFetch({ body: { id_token: "not-a-jwt" } });
  await assert.rejects(
    completeSignIn({ query: new URLSearchParams({ code: "c" }), env: ENV, codeVerifier: VERIFIER, fetchImpl }),
    (error) => error instanceof CallbackError && error.code === "id_token_malformed",
  );
});

async function withEnv(values, body) {
  const previous = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await body();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("the handler answers API Gateway-shaped events", async () => {
  await withEnv(ENV, async () => {
    const response = await handler({ queryStringParameters: { state: "s" } });
    assert.equal(response.statusCode, 400);
    assert.equal(JSON.parse(response.body).error, "missing_code");
  });
});

test("the handler reports missing deployment settings instead of throwing", async () => {
  await withEnv(
    { HUAWEI_CLIENT_ID: undefined, WEB_ORIGIN: undefined },
    async () => {
      const response = await handler({ rawQueryString: "code=abc&state=s" });
      assert.equal(response.statusCode, 500);
      assert.equal(JSON.parse(response.body).error, "not_configured");
    },
  );
});

test("encodeResult round-trips through the fragment reader the client uses", () => {
  const encoded = encodeResult({ state: "s", openId: "o" });
  assert.deepEqual(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")), { state: "s", openId: "o" });
});
