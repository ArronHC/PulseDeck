import {
  Callout,
  Flex,
  Text,
  Popover,
  IconButton,
  Switch,
} from "@radix-ui/themes";
import { useTranslation } from "react-i18next";
import React, { useCallback, useEffect, useMemo, Suspense } from "react";
import { Link } from "react-router-dom";
const loadNodeDisplay = () => import("../components/NodeDisplay");
const NodeDisplay = React.lazy(loadNodeDisplay);
void loadNodeDisplay();
import { formatBytes, formatSpeed } from "@/utils/unitHelper";
import { useLiveData, useLiveDataMeta } from "../contexts/LiveDataContext";
import { useNodeList } from "@/contexts/NodeListContext";
import { AccountProvider, useAccount } from "@/contexts/AccountContext";
import Loading from "@/components/loading";
import {
  Activity,
  ArrowRight,
  Globe,
  HardDriveUpload,
  LogIn,
  Server,
  Settings,
} from "lucide-react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import type { LiveData } from "@/types/LiveData";
import { AnimatePresence, motion } from "motion/react";
import {
  CONTENT_MOTION,
  MOTION_DURATION,
  MOTION_EASE,
  MOTION_SPRING,
} from "@/lib/motion";
import { useKmReducedMotion } from "@/components/motion/MotionProvider";
import { AnimatedNumber, Collapse } from "@/components/motion";
import { Skeletonize, skeletonText } from "@/components/ui/skeleton";
import { HubEmptyState } from "@/components/hub/HubUi";
import { loginPath } from "@/utils/loginRedirect";

const EMPTY_LIVE_DATA: LiveData = { online: [], data: {} };

const STATUS_CARD_VISIBILITY_DEFAULTS = {
  currentOnline: true,
  regionOverview: true,
  trafficOverview: true,
  networkSpeed: true,
};

type StatusCardKey = keyof typeof STATUS_CARD_VISIBILITY_DEFAULTS;

const ERROR_LINGER_MS = 1500;

const Index = () => {
  return (
    <AccountProvider>
      <DefaultProbeView />
    </AccountProvider>
  );
};

const DefaultProbeView = () => {
  const [t] = useTranslation();
  const { account } = useAccount();
  const isAdmin = Boolean(account?.logged_in);
  const { live_data, showCallout } = useLiveData();
  const { nodeList, isLoading, error, refresh } = useNodeList();
  const listLoading = isLoading && !nodeList;
  const liveLoading = live_data === null && showCallout;
  const statsLoading = listLoading || liveLoading;
  const [shownError, setShownError] = React.useState<string | null>(error);
  if (error && error !== shownError) setShownError(error);
  useEffect(() => {
    if (error || !shownError) return;
    const id = window.setTimeout(() => setShownError(null), ERROR_LINGER_MS);
    return () => window.clearTimeout(id);
  }, [error, shownError]);
  const liveData = live_data?.data ?? EMPTY_LIVE_DATA;
  const onlineSet = useMemo(
    () => new Set(liveData.online),
    [liveData.online],
  );
  const [statusCardsVisibility, setStatusCardsVisibility] = useLocalStorage<
    Record<StatusCardKey, boolean>
  >("statusCardsVisibilityV2", STATUS_CARD_VISIBILITY_DEFAULTS);

  const summaryStats = useMemo(() => {
    const regions = new Set<string>();
    let totalUp = 0;
    let totalDown = 0;
    let speedUp = 0;
    let speedDown = 0;

    for (const node of nodeList ?? []) {
      if (!onlineSet.has(node.uuid)) continue;

      if (node.region) regions.add(node.region);
      const record = liveData.data[node.uuid];
      if (!record) continue;

      totalUp += record.network.totalUp || 0;
      totalDown += record.network.totalDown || 0;
      speedUp += record.network.up || 0;
      speedDown += record.network.down || 0;
    }

    return {
      regionCount: regions.size,
      trafficText: `↑ ${formatBytes(totalUp)} / ↓ ${formatBytes(totalDown)}`,
      speedText: `↑ ${formatSpeed(speedUp)} / ↓ ${formatSpeed(speedDown)}`,
    };
  }, [liveData.data, nodeList, onlineSet]);

  const statusCards = useMemo(
    () => [
      {
        key: "currentOnline" as const,
        icon: Server,
        title: t("current_online", "在线节点"),
        value: (
          <Skeletonize as="span" loading={statsLoading} className="font-mono tabular-nums">
            {statsLoading ? (
              skeletonText(5)
            ) : (
              <>
                <AnimatedNumber value={onlineSet.size} duration={MOTION_DURATION.slower} /> /{" "}
                {nodeList?.length ?? 0}
              </>
            )}
          </Skeletonize>
        ),
        visible: statusCardsVisibility.currentOnline,
      },
      {
        key: "regionOverview" as const,
        icon: Globe,
        title: t("region_overview", "覆盖地区"),
        value: (
          <Skeletonize as="span" loading={statsLoading} className="font-mono tabular-nums">
            {statsLoading ? (
              skeletonText(2)
            ) : (
              <AnimatedNumber value={summaryStats.regionCount} duration={MOTION_DURATION.slower} />
            )}
          </Skeletonize>
        ),
        visible: statusCardsVisibility.regionOverview,
      },
      {
        key: "trafficOverview" as const,
        icon: HardDriveUpload,
        title: t("traffic_overview", "总流量"),
        value: (
          <Skeletonize as="span" loading={statsLoading} className="font-mono tabular-nums">
            {statsLoading ? skeletonText(16) : summaryStats.trafficText}
          </Skeletonize>
        ),
        visible: statusCardsVisibility.trafficOverview,
      },
      {
        key: "networkSpeed" as const,
        icon: Activity,
        title: t("network_speed", "实时速率"),
        value: (
          <Skeletonize as="span" loading={statsLoading} className="font-mono tabular-nums">
            {statsLoading ? skeletonText(18) : summaryStats.speedText}
          </Skeletonize>
        ),
        visible: statusCardsVisibility.networkSpeed,
      },
    ],
    [nodeList?.length, onlineSet.size, statsLoading, statusCardsVisibility, summaryStats, t],
  );

  const visibleStatusCards = useMemo(
    () => statusCards.filter((card) => card.visible),
    [statusCards],
  );

  const updateStatusCardVisibility = useCallback(
    (key: StatusCardKey, checked: boolean) => {
      setStatusCardsVisibility((current) => ({
        ...current,
        [key]: checked,
      }));
    },
    [setStatusCardsVisibility],
  );

  useEffect(() => {
    let interval: number | undefined;
    const stopPolling = () => {
      if (interval !== undefined) {
        window.clearInterval(interval);
        interval = undefined;
      }
    };
    const startPolling = () => {
      if (interval === undefined && !document.hidden) {
        interval = window.setInterval(refresh, 5000);
      }
    };
    const handleVisibilityChange = () => {
      stopPolling();
      if (!document.hidden) {
        refresh();
        startPolling();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    startPolling();
    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refresh]);

  const isEmpty = !listLoading && (nodeList?.length ?? 0) === 0;

  return (
    <div className="space-y-6">
      <Callouts />

      {/* Header + Settings trigger */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--hub-ink)]">
            {t("pulse.servers.title")}
          </h1>
          <p className="mt-0.5 text-xs text-[var(--hub-muted)]">
            {t("pulse.servers.subtitle")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <Link
              to="/admin/servers"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] px-3 text-xs font-medium text-[var(--hub-ink)] no-underline transition-colors hover:bg-[var(--hub-canvas)]"
            >
              <span>{t("pulse.servers.manageServers")}</span>
              <ArrowRight className="h-3.5 w-3.5 text-[var(--hub-muted)]" />
            </Link>
          )}
          <Popover.Root>
            <Popover.Trigger>
              <IconButton
                variant="soft"
                size="2"
                title={t("status_settings", "Status Settings")}
                aria-label={t("status_settings", "Status Settings")}
              >
                <Settings size={15} />
              </IconButton>
            </Popover.Trigger>
            <Popover.Content width="280px">
              <Flex direction="column" gap="3">
                <Text size="2" weight="bold">
                  {t("status_settings", "Status Settings")}
                </Text>
                <Flex direction="column" gap="2">
                  {statusCards.map((card) => (
                    <StatusSettingSwitch
                      key={card.key}
                      label={card.title}
                      checked={card.visible}
                      onCheckedChange={(checked) =>
                        updateStatusCardVisibility(card.key, checked)
                      }
                    />
                  ))}
                </Flex>
              </Flex>
            </Popover.Content>
          </Popover.Root>
        </div>
      </div>

      {/* 4-Metric Neutral Bento Summary Strip */}
      {visibleStatusCards.length > 0 && (
        <div className="km-page-index grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <AnimatePresence initial={false} mode="popLayout">
            {visibleStatusCards.map((card, index) => (
              <TopCard
                key={card.key}
                icon={card.icon}
                title={card.title}
                value={card.value}
                index={index}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      <Collapse open={!!shownError} aria-hidden={!shownError}>
        <Callout.Root color="red" className="km-callout km-callout-nodes-error">
          <Callout.Text>Error: {shownError ?? error}</Callout.Text>
        </Callout.Root>
      </Collapse>

      {isEmpty ? (
        <HubEmptyState
          icon={Server}
          title={t("pulse.servers.emptyTitle")}
          description={
            isAdmin
              ? t("pulse.servers.emptyAdminDesc")
              : t("pulse.servers.emptyGuestDesc")
          }
          action={
            isAdmin ? (
              <Link
                to="/admin/servers"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 text-xs font-medium text-white no-underline hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                <span>{t("pulse.servers.goToAddNodes")}</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            ) : (
              <Link
                to={loginPath("/admin/servers")}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] px-3 text-xs font-medium text-[var(--hub-ink)] no-underline hover:bg-[var(--hub-canvas)]"
              >
                <LogIn className="h-3.5 w-3.5" />
                <span>{t("pulse.common.adminLogin")}</span>
              </Link>
            )
          }
        />
      ) : (
        <Suspense
          fallback={
            <div className="mt-4">
              <Loading reveal={false} />
            </div>
          }
        >
          <NodeDisplay
            nodes={nodeList ?? []}
            liveData={liveData}
            onlineSet={onlineSet}
            loading={listLoading}
            liveLoading={liveLoading}
          />
        </Suspense>
      )}
    </div>
  );
};

const CalloutBanner = ({
  show,
  children,
}: {
  show: boolean;
  children: React.ReactNode;
}) => (
  <Collapse
    open={show}
    aria-hidden={!show}
    {...({ inert: !show } as object)}
  >
    {children}
  </Collapse>
);

const Callouts = React.memo(() => {
  const [t] = useTranslation();
  const { showCallout } = useLiveDataMeta();
  const ishttps = window.location.protocol === "https:";
  return (
    <div className="km-callouts flex flex-col">
      <CalloutBanner show={!ishttps}>
        <Callout.Root
          mb="3"
          color="red"
          className="km-callout km-callout-https"
        >
          <Callout.Text>
            <Text size="2" weight="medium">
              {t("warn_https")}
            </Text>
          </Callout.Text>
        </Callout.Root>
      </CalloutBanner>
      <CalloutBanner show={!showCallout}>
        <Callout.Root
          mb="3"
          id="callout"
          color="tomato"
          className="km-callout km-callout-websocket"
        >
          <Callout.Text>
            <Text size="2" weight="medium">
              {t("warn_websocket")}
            </Text>
          </Callout.Text>
        </Callout.Root>
      </CalloutBanner>
    </div>
  );
});

export default Index;

type TopCardProps = {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  value: React.ReactNode;
  index?: number;
  ref?: React.Ref<HTMLDivElement>;
};

const TopCard: React.FC<TopCardProps> = React.memo(
  ({ icon: Icon, title, value, index = 0, ref }) => {
    const reduced = useKmReducedMotion();
    const [delay] = React.useState(() =>
      reduced ? 0 : Math.min(index * 0.04, 0.16),
    );
    return (
      <motion.div
        ref={ref}
        layout="position"
        className="km-top-card rounded-xl border border-[var(--hub-border)] bg-[var(--hub-surface)] p-4"
        style={{ transitionProperty: "color, background-color, border-color, box-shadow" }}
        initial={reduced ? { opacity: 1 } : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={
          reduced
            ? { opacity: 0, transition: CONTENT_MOTION.exitTransition }
            : { opacity: 0, scale: 0.96, transition: CONTENT_MOTION.exitTransition }
        }
        transition={{
          layout: MOTION_SPRING.layout,
          y: { ...MOTION_SPRING.layout, delay },
          opacity: {
            duration: MOTION_DURATION.base,
            ease: MOTION_EASE.out,
            delay,
          },
        }}
      >
        <div className="flex items-center justify-between text-xs text-[var(--hub-muted)]">
          <span>{title}</span>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="mt-2 text-lg font-semibold tracking-tight text-[var(--hub-ink)] font-mono tabular-nums">
          {value}
        </div>
      </motion.div>
    );
  },
);

type StatusSettingSwitchProps = {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

const StatusSettingSwitch: React.FC<StatusSettingSwitchProps> = React.memo(
  ({ label, checked, onCheckedChange }) => {
    return (
      <Flex justify="between" align="center">
        <Text size="2">{label}</Text>
        <Switch checked={checked} onCheckedChange={onCheckedChange} />
      </Flex>
    );
  },
);
