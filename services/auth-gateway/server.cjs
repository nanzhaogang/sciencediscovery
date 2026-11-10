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
 * Local HTTP wrapper around `completeSignIn`, for pilots that cannot afford a
 * Huawei Cloud API Gateway instance.
 *
 * The browser is redirected by HUAWEI to `http://127.0.0.1:8787/callback`, this
 * server trades the code for an ID token and answers with the same 302 to
 * `/login#auth=…` the cloud function would send. Register exactly that URL as
 * the callback in AppGallery Connect.
 *
 * The PKCE verifier arrives in a cookie the web app set on the same host; ports
 * do not isolate cookies, so :5173 and :8787 share it. That verifier is the only
 * proof the exchange needs, so no client secret is stored anywhere.
 *
 * Environment: HUAWEI_CLIENT_ID, WEB_ORIGIN (required);
 * HUAWEI_REDIRECT_URI; CALLBACK_PORT (default 8787).
 */

"use strict";

const http = require("node:http");

const { CLEAR_PKCE_COOKIE, CallbackError, PKCE_COOKIE, completeSignIn, readCookie } = require("./index.cjs");

const PORT = Number(process.env.CALLBACK_PORT ?? 8787);
const HOST = process.env.CALLBACK_HOST ?? "127.0.0.1";

function send(response, status, headers, body) {
  response.writeHead(status, { "cache-control": "no-store", ...headers });
  response.end(body);
}

async function handle(request, response) {
  const query = new URL(request.url ?? "/", `http://${HOST}:${PORT}`).searchParams;
  try {
    const result = await completeSignIn({
      query,
      codeVerifier: readCookie(request.headers, PKCE_COOKIE),
    });
    send(response, result.status, { location: result.location, "set-cookie": CLEAR_PKCE_COOKIE }, "");
  } catch (error) {
    const status = error instanceof CallbackError ? error.status : 500;
    const code = error instanceof CallbackError ? error.code : "internal_error";
    console.error("huawei sign-in failed", code, error instanceof Error ? error.message : error);
    send(
      response,
      status,
      { "content-type": "application/json; charset=utf-8" },
      JSON.stringify({ error: code, detail: error instanceof Error ? error.message : String(error) }),
    );
  }
}

const server = http.createServer((request, response) => {
  handle(request, response).catch((error) => {
    console.error("callback server crashed", error);
    send(response, 500, { "content-type": "application/json; charset=utf-8" }, JSON.stringify({ error: "internal_error" }));
  });
});

server.listen(PORT, HOST, () => {
  console.log(`HUAWEI ID callback listening on http://${HOST}:${PORT}/callback`);
});

// The dev server restarts often; close the listener so the port is released.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
