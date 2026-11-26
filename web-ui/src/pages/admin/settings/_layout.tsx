import { Flex } from "@radix-ui/themes";
import { useRef } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { motion } from "motion/react";
import { SURFACE_MOTION } from "@/lib/motion";

const SETTINGS_TABS = [
  { label: "站点设置", to: "/admin/settings/site" },
  { label: "常规与 GeoIP", to: "/admin/settings/general" },
  { label: "自定义代码", to: "/admin/settings/custom" },
  { label: "登录与 API", to: "/admin/settings/sign-on" },
  { label: "指标与数据库", to: "/admin/settings/metrics" },
];

export default function SettingLayout() {
  const location = useLocation();
  const routeKey = location.pathname;
  const mountedKey = useRef(routeKey);

  return (
    <Flex
      direction="column"
      className="km-admin-settings-layout km-admin-settings-content"
      style={{ minHeight: 0 }}
    >
      <div className="mb-5 flex flex-wrap items-center gap-1.5 border-b border-[var(--hub-border)] pb-3">
        {SETTINGS_TABS.map((tab) => {
          const active = location.pathname === tab.to;
          return (
            <Link
              key={tab.to}
              to={tab.to}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium no-underline transition-colors ${
                active
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "border border-[var(--hub-border)] bg-[var(--hub-surface)] text-[var(--hub-muted)] hover:text-[var(--hub-ink)]"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      <motion.div
        key={routeKey}
        className="km-admin-settings-page flex w-full flex-col gap-km-block"
        style={{ minHeight: 0 }}
        initial={routeKey === mountedKey.current ? false : SURFACE_MOTION.routeFade.initial}
        animate={SURFACE_MOTION.routeFade.animate}
        transition={SURFACE_MOTION.routeFade.transition}
      >
        <Outlet />
      </motion.div>
    </Flex>
  );
}
