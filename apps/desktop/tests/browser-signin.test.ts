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

import { createTest } from "../../../test/support/tagged/compat.mjs";
const { test } = createTest(import.meta.url, {
  tags: ["category:ut", "os:linux", "os:macos", "os:windows", "arch:amd64", "arch:arm64"],
});
import assert from "node:assert/strict";

import { browserSignInAvailable, startBrowserSignIn } from "../src/auth/browser-signin.js";

type Callback = (result: { ticket?: string; error?: string }) => void;

/** Install a fake `window` for the duration of one case, then restore it: the
 *  module feature-detects the shell bridge on `window.sdShell`. */
async function withWindow(value: unknown, run: () => Promise<void>): Promise<void> {
  const had = Object.prototype.hasOwnProperty.call(globalThis, "window");
  const previous = (globalThis as Record<string, unknown>).window;
  (globalThis as Record<string, unknown>).window = value;
  try {
    await run();
  } finally {
    if (had) (globalThis as Record<string, unknown>).window = previous;
    else delete (globalThis as Record<string, unknown>).window;
  }
}

test("without the shell bridge the browser flow is unavailable", async () => {
  await withWindow(undefined, async () => {
    assert.equal(browserSignInAvailable(), false);
    const flow = startBrowserSignIn(() => "https://accounts.test/sign-in");
    assert.equal(await flow.result, null);
  });
});

test("the shell bridge opens the built URL and yields the callback ticket", async () => {
  const opened: string[] = [];
  let deliver: Callback | undefined;
  const bridge = {
    begin: async () => ({ callbackUrl: "http://127.0.0.1:43210/callback" }),
    open: async (url: string) => { opened.push(url); },
    cancel: async () => {},
    onResult: (callback: Callback) => {
      deliver = callback;
      return () => { deliver = undefined; };
    },
  };
  await withWindow({ sdShell: { accountSignIn: bridge } }, async () => {
    assert.equal(browserSignInAvailable(), true);
    const flow = startBrowserSignIn(
      (callbackUrl) => `https://accounts.test/v1/auth/huawei/start?returnUrl=${encodeURIComponent(callbackUrl)}`,
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(opened, [
      "https://accounts.test/v1/auth/huawei/start?returnUrl=http%3A%2F%2F127.0.0.1%3A43210%2Fcallback",
    ]);
    deliver?.({ ticket: "ticket-1" });
    assert.deepEqual(await flow.result, { ticket: "ticket-1" });
  });
});

test("the shell bridge reports a failed sign-in", async () => {
  let deliver: Callback | undefined;
  const bridge = {
    begin: async () => ({ callbackUrl: "http://127.0.0.1:43211/callback" }),
    open: async () => {},
    cancel: async () => {},
    onResult: (callback: Callback) => {
      deliver = callback;
      return () => { deliver = undefined; };
    },
  };
  await withWindow({ sdShell: { accountSignIn: bridge } }, async () => {
    const flow = startBrowserSignIn((callbackUrl) => `https://accounts.test/start?returnUrl=${callbackUrl}`);
    await new Promise((resolve) => setImmediate(resolve));
    deliver?.({ error: "access_denied" });
    assert.deepEqual(await flow.result, { error: "access_denied" });
  });
});

test("cancelling resolves the flow and closes the shell callback", async () => {
  let cancelled = false;
  const bridge = {
    begin: async () => ({ callbackUrl: "http://127.0.0.1:43212/callback" }),
    open: async () => {},
    cancel: async () => { cancelled = true; },
    onResult: () => () => {},
  };
  await withWindow({ sdShell: { accountSignIn: bridge } }, async () => {
    const flow = startBrowserSignIn((callbackUrl) => callbackUrl);
    await new Promise((resolve) => setImmediate(resolve));
    flow.cancel();
    assert.equal(await flow.result, null);
    assert.equal(cancelled, true);
  });
});
