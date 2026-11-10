#!/usr/bin/env node
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
 * Starts the HUAWEI ID callback service with the settings the web app already
 * uses, so nothing has to be typed on the command line.
 *
 * `apps/web/.env.local` is the single source of truth: it carries the same
 * client id and callback URL the web build reads as `VITE_*`. A variable already
 * present in the environment wins, which keeps CI and one-off overrides working.
 *
 * The sign-in is PKCE, so there is no client secret to supply anywhere.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Mirrors the dev server origin in `apps/web/vite.config.ts`. */
const WEB_ORIGIN_DEFAULT = "http://127.0.0.1:5173";

/** Reads `KEY=VALUE` lines; comments are skipped and quotes are stripped. */
async function readEnvFile(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return {};
  }
  const values = {};
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (/^(['"]).*\1$/u.test(value)) value = value.slice(1, -1);
    values[key] = value;
  }
  return values;
}

const local = await readEnvFile(resolve(repositoryRoot, "apps/web/.env.local"));
const port = process.env.CALLBACK_PORT?.trim() || "8787";

const settings = {
  HUAWEI_CLIENT_ID: process.env.HUAWEI_CLIENT_ID ?? local.VITE_HUAWEI_CLIENT_ID ?? "",
  HUAWEI_REDIRECT_URI:
    process.env.HUAWEI_REDIRECT_URI ??
    local.VITE_HUAWEI_REDIRECT_URI ??
    `http://127.0.0.1:${port}/callback`,
  WEB_ORIGIN: process.env.WEB_ORIGIN ?? WEB_ORIGIN_DEFAULT,
  CALLBACK_PORT: port,
};

if (!settings.HUAWEI_CLIENT_ID) {
  console.error(
    "apps/web/.env.local has no VITE_HUAWEI_CLIENT_ID, so there is no HUAWEI app to call.\n" +
      "Add VITE_HUAWEI_CLIENT_ID and VITE_HUAWEI_REDIRECT_URI there, or export HUAWEI_CLIENT_ID.",
  );
  process.exit(1);
}

for (const [key, value] of Object.entries(settings)) process.env[key] = value;

console.log(
  `HUAWEI ID callback: client ${settings.HUAWEI_CLIENT_ID}, port ${port}, ` +
    `web origin ${settings.WEB_ORIGIN}, redirect ${settings.HUAWEI_REDIRECT_URI}`,
);

await import("../services/auth-gateway/server.cjs");
