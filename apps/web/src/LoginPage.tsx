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
 * Full-screen sign-in for the browser client.
 *
 * Scheme A: the button leaves for the HUAWEI ID page, where the phone number
 * and the SMS code are handled entirely by HUAWEI. HUAWEI then calls the
 * callback service, which verifies the code and sends the browser back to
 * `/login#auth=…`. This component checks `state` against the value it stored
 * before leaving and keeps the identity. No profile form is shown — the display
 * name and email come from the HUAWEI ID profile, and a generic label is used
 * when the profile shares neither.
 */

import { useEffect, useState } from "react";

import {
  buildHuaweiAuthorizeUrl,
  consumeAuthorizeState,
  createAuthorizeState,
  createCodeChallenge,
  createCodeVerifier,
  previewSignIn,
  readAuthorizeFailure,
  readAuthorizeResult,
  readHuaweiConfig,
  rememberAuthorizeState,
  rememberCodeVerifier,
  type HuaweiIdentity,
} from "./auth/huawei.js";
import { clearSession, readSession, saveSession, type UserSession } from "./auth/session.js";
import { useLocale } from "./i18n/index.js";

/** Credits granted the moment an account is created. */
export const REGISTRATION_CREDITS = 500;

type Step = "idle" | "redirecting" | "done" | "error";

export interface LoginPageProps {
  /** Called when the user leaves the sign-in screen for the workspace. */
  onAuthenticated?: (session: UserSession) => void;
}

const CHECK = "M3 8.5 6.5 12 13 4.5";

export function LoginPage({ onAuthenticated }: LoginPageProps) {
  const { t } = useLocale();
  const [stored, setStored] = useState(() => readSession());
  const [config] = useState(() => readHuaweiConfig());
  const [step, setStep] = useState<Step>(stored ? "done" : "idle");
  const [session, setSession] = useState<UserSession | undefined>(stored);

  useEffect(() => {
    const result = readAuthorizeResult(window.location.hash);
    if (!result) {
      if (!readAuthorizeFailure(window.location.hash)) return;
      window.history.replaceState(null, "", window.location.pathname);
      setStep("error");
      return;
    }
    const expected = consumeAuthorizeState();
    window.history.replaceState(null, "", window.location.pathname);
    if (!expected || expected !== result.state) {
      setStep("error");
      return;
    }
    establish(result.identity);
  }, []);

  function establish(identity: HuaweiIdentity): void {
    const existing = stored && stored.openId === identity.openId ? stored : undefined;
    const created: UserSession = {
      openId: identity.openId,
      displayName: identity.displayName?.trim() || t("login.defaultName"),
      email: identity.email?.trim() || undefined,
      grantedCredits: existing?.grantedCredits ?? REGISTRATION_CREDITS,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    saveSession(created);
    setStored(created);
    setSession(created);
    setStep("done");
  }

  async function startSignIn(): Promise<void> {
    const available = config;
    if (!available) {
      setStep("redirecting");
      void previewSignIn().then(establish).catch(() => setStep("error"));
      return;
    }
    const state = createAuthorizeState();
    const verifier = createCodeVerifier();
    try {
      const codeChallenge = await createCodeChallenge(verifier);
      // Both must be stored before leaving: `state` is matched when we come back
      // and the verifier, written as a cookie, is what lets the callback service
      // finish the exchange without holding a secret.
      rememberAuthorizeState(state);
      rememberCodeVerifier(verifier);
      setStep("redirecting");
      window.location.assign(buildHuaweiAuthorizeUrl({ ...available, state, codeChallenge }));
    } catch {
      setStep("error");
    }
  }

  function signOut(): void {
    clearSession();
    setStored(undefined);
    setSession(undefined);
    setStep("idle");
  }

  return (
    <div className="login-page">
      <section className="login-brand" aria-hidden="true">
        <div className="login-brand-inner">
          <span className="login-brand-mark">
            <svg fill="none" height="22" viewBox="0 0 22 22" width="22">
              <circle cx="11" cy="11" r="9.2" stroke="currentColor" strokeWidth="1.6" />
              <circle cx="11" cy="11" r="3.4" fill="currentColor" />
            </svg>
          </span>
          <p className="login-brand-name">ScienceDiscovery</p>
          <h1 className="login-brand-title">{t("login.brandTitle")}</h1>
          <p className="login-brand-tagline">{t("login.brandTagline")}</p>
          <ul className="login-benefits">
            <li><span className="login-check" aria-hidden="true"><svg fill="none" viewBox="0 0 16 16"><path d={CHECK} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg></span>{t("login.benefit.credits", { credits: REGISTRATION_CREDITS })}</li>
            <li><span className="login-check" aria-hidden="true"><svg fill="none" viewBox="0 0 16 16"><path d={CHECK} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg></span>{t("login.benefit.noCard")}</li>
            <li><span className="login-check" aria-hidden="true"><svg fill="none" viewBox="0 0 16 16"><path d={CHECK} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg></span>{t("login.benefit.byok")}</li>
          </ul>
          <p className="login-brand-footnote">{t("login.brandFootnote")}</p>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-card">
          {step === "done" && session ? (
            <div className="login-done">
              <span className="login-done-mark" aria-hidden="true">
                <svg fill="none" viewBox="0 0 24 24"><path d="M4.5 12.5 9.5 17.5 19.5 6.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>
              </span>
              <h2>{t("login.doneTitle")}</h2>
              <p className="login-lead">{t("login.doneBody", { name: session.displayName, credits: session.grantedCredits })}</p>
              <button className="primary-button login-wide" onClick={() => onAuthenticated?.(session)} type="button">
                {t("login.enter")}
              </button>
              <button className="login-link-button" onClick={signOut} type="button">{t("login.signOut")}</button>
            </div>
          ) : step === "redirecting" ? (
            <div className="login-busy">
              <span className="login-spinner" aria-hidden="true" />
              <p className="login-lead">{t("login.redirecting")}</p>
            </div>
          ) : step === "error" ? (
            <div className="login-form">
              <h2>{t("login.errorTitle")}</h2>
              <p className="login-lead">{t("login.errorBody")}</p>
              <button className="primary-button login-wide" onClick={() => setStep("idle")} type="button">
                {t("login.retry")}
              </button>
            </div>
          ) : (
            <div className="login-form">
              <p className="login-eyebrow">{t("login.eyebrow")}</p>
              <h2>{t("login.title")}</h2>
              <p className="login-lead">{t("login.subtitle")}</p>

              <button className="login-huawei-button login-wide" onClick={startSignIn} type="button">
                <span className="login-huawei-mark" aria-hidden="true">ID</span>{t("login.huaweiButton")}
              </button>

              {config ? null : <p className="login-hint login-offline-hint">{t("login.offlineNotice")}</p>}

              <p className="login-consent">{t("login.consent")}</p>

              <div className="login-divider"><span>{t("login.or")}</span></div>
              <a className="login-link-button" href="/settings/connection">{t("login.localToken")}</a>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
