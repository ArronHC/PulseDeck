import { useContext, useEffect } from "react";
import { LoaderCircle, LogIn, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import LanguageSwitch from "@/components/Language";
import LoginField from "@/components/auth/LoginField";
import { useLogin } from "@/components/auth/useLogin";
import { AccountProvider, useAccount } from "@/contexts/AccountContext";
import { usePublicInfo } from "@/contexts/PublicInfoContext";
import { ThemeContext } from "@/contexts/ThemeContext";
import { useSystemTheme } from "@/hooks/useSystemTheme";
import { Skeletonize } from "@/components/ui/skeleton";
import { AutoHeight, PresenceBox } from "@/components/motion";
import { resolveLoginRedirect } from "@/utils/loginRedirect";
import { AnimatePresence, motion } from "motion/react";
import { FEEDBACK_MOTION, SURFACE_MOTION } from "@/lib/motion";

const AdminLoginPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { account, loading, refresh } = useAccount();
  const { publicInfo, isLoading: publicInfoLoading } = usePublicInfo();
  const { appearance, setAppearance } = useContext(ThemeContext);
  const resolvedAppearance = useSystemTheme(appearance);
  const isDark = resolvedAppearance === "dark";

  const redirect = resolveLoginRedirect(searchParams.get("redirect"));
  const {
    username,
    setUsername,
    password,
    setPassword,
    twoFactor,
    setTwoFactor,
    requireTwoFactor,
    error,
    busy,
    login,
  } = useLogin({
    onSuccess: async () => {
      await refresh();
      navigate(redirect, { replace: true });
    },
  });
  const passwordLoginEnabled = !publicInfo?.disable_password_login;
  const oauthEnabled = !!publicInfo?.oauth_enable;
  const canSubmit =
    passwordLoginEnabled && username.trim() !== "" && password !== "";

  useEffect(() => {
    if (!loading && account?.logged_in) {
      navigate(redirect, { replace: true });
    }
  }, [account, loading, navigate, redirect]);

  const pageLoading = loading || publicInfoLoading;
  if (!pageLoading && account?.logged_in) {
    return <Navigate to={redirect} replace />;
  }

  return (
    <div className="km-login-page relative flex min-h-screen items-center justify-center bg-[var(--hub-canvas)] px-4 py-12 text-[var(--hub-ink)]">
      <div className="absolute right-4 top-4 flex items-center gap-2 sm:right-6 sm:top-6">
        <Link
          to="/"
          className="inline-flex h-8 items-center rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] px-3 text-xs font-medium text-[var(--hub-muted)] no-underline hover:text-[var(--hub-ink)]"
        >
          返回状态页
        </Link>
        <button
          type="button"
          onClick={() => setAppearance(isDark ? "light" : "dark")}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] text-[var(--hub-muted)] hover:text-[var(--hub-ink)]"
          aria-label="Toggle theme"
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <LanguageSwitch />
      </div>

      <motion.div
        className="w-full max-w-[420px]"
        initial={SURFACE_MOTION.enter.initial}
        animate={SURFACE_MOTION.enter.animate}
        transition={SURFACE_MOTION.enter.transition}
      >
        <Skeletonize loading={pageLoading} label>
          <div className="km-login-card w-full rounded-2xl border border-[var(--hub-border)] bg-[var(--hub-surface)] p-6 shadow-sm sm:p-8">
            <AutoHeight>
              <div className="space-y-6">
                <div className="space-y-3">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
                      <svg
                        viewBox="0 0 24 24"
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M4 14h4l2-7 4 14 2-7h4" />
                      </svg>
                    </span>
                    <span className="text-sm font-semibold tracking-tight">
                      {publicInfo?.sitename || "PulseDeck"}
                    </span>
                    <span className="rounded border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--hub-muted)]">
                      控制台
                    </span>
                  </div>
                  <div>
                    <h1 className="text-xl font-semibold tracking-tight">
                      {t("login.title", "登录管理后台")}
                    </h1>
                    <p className="mt-1 text-xs text-[var(--hub-muted)]">
                      {t("login.desc", "输入管理员凭证以访问资产管理与系统配置")}
                    </p>
                  </div>
                </div>

                <form
                  className="km-login-form space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (canSubmit && !busy) {
                      void login();
                    }
                  }}
                >
                  {passwordLoginEnabled && (
                    <div className="space-y-4">
                      <LoginField
                        label={t("login.username")}
                        key={pageLoading ? "loading" : "ready"}
                        className="km-login-input"
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        name="username"
                        autoComplete="username"
                        placeholder="admin"
                        disabled={busy}
                        autoFocus
                      />
                      <LoginField
                        label={t("login.password")}
                        className="km-login-input"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        name="password"
                        type="password"
                        autoComplete="current-password"
                        placeholder={t("login.password_placeholder")}
                        disabled={busy}
                      />
                      <AnimatePresence initial={false}>
                        {requireTwoFactor && (
                          <PresenceBox key="two-factor">
                            <LoginField
                              label={t("login.two_factor")}
                              className="km-login-input"
                              value={twoFactor}
                              onChange={(event) =>
                                setTwoFactor(event.target.value)
                              }
                              name="2fa_code"
                              autoComplete="one-time-code"
                              inputMode="numeric"
                              placeholder="000000"
                              disabled={busy}
                            />
                          </PresenceBox>
                        )}
                      </AnimatePresence>
                      <AnimatePresence initial={false} mode="wait">
                        {error && (
                          <motion.div
                            key={error}
                            initial={FEEDBACK_MOTION.pop.initial}
                            animate={FEEDBACK_MOTION.pop.animate}
                            exit={FEEDBACK_MOTION.pop.exit}
                            transition={FEEDBACK_MOTION.pop.transition}
                          >
                            <div className="km-login-error rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/50 dark:text-rose-200">
                              {error}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}

                  {(passwordLoginEnabled || oauthEnabled) && (
                    <div className="space-y-2.5 pt-1">
                      {passwordLoginEnabled && (
                        <button
                          type="submit"
                          disabled={busy || !canSubmit}
                          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 text-xs font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                        >
                          {busy ? (
                            <LoaderCircle className="h-4 w-4 animate-spin" />
                          ) : (
                            <LogIn className="h-4 w-4" />
                          )}
                          <span>
                            {busy ? t("loading", "登录中...") : t("login.title", "登录")}
                          </span>
                        </button>
                      )}
                      {oauthEnabled && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            sessionStorage.setItem("oauth_redirect", redirect);
                            window.location.href = "/api/oauth";
                          }}
                          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-4 text-xs font-medium text-[var(--hub-ink)] transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
                        >
                          {t("login.login_with", {
                            provider:
                              publicInfo?.oauth_provider === "generic"
                                ? "OAuth"
                                : publicInfo?.oauth_provider
                                  ? publicInfo.oauth_provider
                                      .charAt(0)
                                      .toUpperCase() +
                                    publicInfo.oauth_provider.slice(1)
                                  : "",
                          })}
                        </button>
                      )}
                    </div>
                  )}
                </form>
              </div>
            </AutoHeight>
          </div>
        </Skeletonize>
      </motion.div>
    </div>
  );
};

const AdminLogin = () => (
  <AccountProvider>
    <AdminLoginPage />
  </AccountProvider>
);

export default AdminLogin;
