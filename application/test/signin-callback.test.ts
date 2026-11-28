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

import test from "node:test";
import assert from "node:assert/strict";

import { startSignInCallbackServer } from "../src/signin-callback.ts";

test("the loopback callback URL serves the browser page", async () => {
  const server = await startSignInCallbackServer({ onResult: () => {} });
  try {
    assert.match(server.callbackUrl, /^http:\/\/127\.0\.0\.1:\d+\/callback$/u);
    const response = await fetch(server.callbackUrl);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/u);
    const page = await response.text();
    assert.match(page, /auth-ticket/u);
    assert.match(page, /\/result/u);
  } finally {
    server.stop();
  }
});

test("a posted ticket reaches the shell once", async () => {
  const results: Array<{ ticket?: string; error?: string }> = [];
  const server = await startSignInCallbackServer({ onResult: (result) => results.push(result) });
  const base = server.callbackUrl.replace(/\/callback$/u, "");
  try {
    const response = await fetch(`${base}/result`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket: "t-1" }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(results, [{ ticket: "t-1" }]);
  } finally {
    server.stop();
  }
});

test("a posted error is delivered without a ticket", async () => {
  const results: Array<{ ticket?: string; error?: string }> = [];
  const server = await startSignInCallbackServer({ onResult: (result) => results.push(result) });
  const base = server.callbackUrl.replace(/\/callback$/u, "");
  try {
    const response = await fetch(`${base}/result`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "access_denied" }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(results, [{ error: "access_denied" }]);
  } finally {
    server.stop();
  }
});

test("a body without a result is rejected", async () => {
  const results: Array<{ ticket?: string; error?: string }> = [];
  const server = await startSignInCallbackServer({ onResult: (result) => results.push(result) });
  const base = server.callbackUrl.replace(/\/callback$/u, "");
  try {
    const response = await fetch(`${base}/result`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(results, []);
  } finally {
    server.stop();
  }
});
