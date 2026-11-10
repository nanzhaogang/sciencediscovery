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
 * The signed-in user, as the browser remembers it.
 *
 * Only three fields are personal: the HUAWEI ID `openId` (an opaque
 * identifier, not a phone number), an optional display name, and an optional
 * email used solely for release notes. Nothing here is an access credential —
 * the server issues its own token once the account service exists, so a
 * tampered local record can never act on the user's behalf.
 */

import type { ReadableStorage } from "../browser-storage.js";

export const SESSION_STORAGE_KEY = "sciencediscovery-session";

export interface UserSession {
  /** HUAWEI ID `openid`: stable per app, reveals nothing about the person. */
  openId: string;
  displayName: string;
  /** Optional; collected only to send release notes and event notices. */
  email?: string;
  /** Credits granted on registration, echoed by the welcome screen. */
  grantedCredits: number;
  /** ISO timestamp of the first successful sign-in. */
  createdAt: string;
}

function browserStorage(): ReadableStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** Parse a stored record, discarding anything that is not a usable session. */
export function parseSession(raw: string | null): UserSession | undefined {
  if (!raw) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Partial<UserSession>;
  if (typeof record.openId !== "string" || !record.openId) return undefined;
  if (typeof record.displayName !== "string" || !record.displayName) return undefined;
  if (typeof record.grantedCredits !== "number" || !Number.isFinite(record.grantedCredits)) return undefined;
  if (typeof record.createdAt !== "string" || !record.createdAt) return undefined;
  return {
    openId: record.openId,
    displayName: record.displayName,
    email: typeof record.email === "string" && record.email ? record.email : undefined,
    grantedCredits: record.grantedCredits,
    createdAt: record.createdAt,
  };
}

export function readSession(storage: ReadableStorage | undefined = browserStorage()): UserSession | undefined {
  try {
    return parseSession(storage?.getItem(SESSION_STORAGE_KEY) ?? null);
  } catch {
    return undefined;
  }
}

export function saveSession(session: UserSession, storage: ReadableStorage | undefined = browserStorage()): void {
  try {
    storage?.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // A storage that refuses the write (private mode, quota) keeps the
    // in-memory session for this page view; the next visit signs in again.
  }
}

export function clearSession(storage: ReadableStorage | undefined = browserStorage()): void {
  try {
    storage?.removeItem?.(SESSION_STORAGE_KEY);
  } catch {
    // Nothing to clean up when the storage is already unreachable.
  }
}
