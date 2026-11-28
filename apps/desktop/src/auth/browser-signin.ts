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
 * HUAWEI sign-in through the system browser.
 *
 * In the Electron shell the sign-in page must open in the user's default
 * browser, not in a window the app owns. The shell exposes a one-shot loopback
 * callback (`window.sdShell.accountSignIn`): the renderer asks it for a
 * callback URL, builds the account-service sign-in URL with that URL as
 * `returnUrl`, and has the shell open it. The single-use ticket comes back as
 * a bridge event, and the caller exchanges it exactly as it did for a
 * same-window callback.
 *
 * A plain browser (the web build, the SPA's own dev server, Playwright) has no
 * bridge, so `browserSignInAvailable()` is false and callers keep the existing
 * in-page navigation. That also keeps the fragment-based callback path — and
 * its tests — working unchanged.
 */

export interface BrowserSignInResult {
  ticket?: string;
  error?: string;
}

export interface BrowserSignInFlow {
  /** Resolves with the ticket or error; `null` when the flow was cancelled. */
  result: Promise<BrowserSignInResult | null>;
  /** Give up: stop listening and tell the shell to close its callback server. */
  cancel: () => void;
}

interface AccountSignInBridge {
  begin: () => Promise<{ callbackUrl: string }>;
  open: (url: string) => Promise<void>;
  cancel: () => Promise<void>;
  onResult: (callback: (result: BrowserSignInResult) => void) => () => void;
}

function bridge(): AccountSignInBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as typeof window & { sdShell?: { accountSignIn?: AccountSignInBridge } })
    .sdShell?.accountSignIn;
}

/** True when the system-browser flow can be used (the Electron shell). */
export function browserSignInAvailable(): boolean {
  return Boolean(bridge());
}

/**
 * Open the account service in the system browser and wait for its callback.
 *
 * `buildSignInUrl` turns the shell's loopback callback URL into the account
 * service's `/v1/auth/huawei/start` URL. The returned flow must be consumed
 * once: the ticket is single-use.
 */
export function startBrowserSignIn(
  buildSignInUrl: (callbackUrl: string) => string,
): BrowserSignInFlow {
  const accountSignIn = bridge();
  if (!accountSignIn) {
    return { result: Promise.resolve(null), cancel: () => {} };
  }

  let unsubscribe: (() => void) | undefined;
  let finished = false;
  let settle: (value: BrowserSignInResult | null) => void = () => {};
  const result = new Promise<BrowserSignInResult | null>((resolve) => { settle = resolve; });

  const finish = (value: BrowserSignInResult | null): void => {
    if (finished) return;
    finished = true;
    unsubscribe?.();
    unsubscribe = undefined;
    settle(value);
  };

  // Subscribe before opening the browser: the callback can arrive before
  // `open` resolves on a fast sign-in.
  unsubscribe = accountSignIn.onResult((value) => finish(value));
  void (async () => {
    try {
      const { callbackUrl } = await accountSignIn.begin();
      if (finished) return;
      await accountSignIn.open(buildSignInUrl(callbackUrl));
    } catch (error) {
      finish({ error: error instanceof Error ? error.message : String(error) });
    }
  })();

  return {
    result,
    cancel: () => {
      if (finished) return;
      finished = true;
      unsubscribe?.();
      unsubscribe = undefined;
      settle(null);
      void accountSignIn.cancel().catch(() => undefined);
    },
  };
}
