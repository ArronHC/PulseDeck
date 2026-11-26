import { Flex, Text } from "@radix-ui/themes";
import { useEffect, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { useRPC2Call } from "@/contexts/RPC2Context";
import { usePublicInfo } from "@/contexts/PublicInfoContext";
import { MOTION_DURATION, MOTION_EASE, MOTION_SPRING } from "@/lib/motion";
import { Skeletonize, skeletonText } from "./ui/skeleton";

const Footer = () => {
  const { i18n } = useTranslation();
  const formatBuildTime = (isoString: string) => {
    const date = new Date(isoString);
    return (
      date.toLocaleString(i18n.resolvedLanguage || i18n.language || "en-US", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: "Asia/Shanghai",
      }) + " (GMT+8)"
    );
  };

  const buildTime =
    typeof __BUILD_TIME__ !== "undefined" ? __BUILD_TIME__ : null;
  const [versionInfo, setVersionInfo] = useState<{
    hash: string;
    version: string;
  } | null>(null);
  const [versionFailed, setVersionFailed] = useState(false);
  const { call } = useRPC2Call();
  const { publicInfo } = usePublicInfo();
  const customFooterHtml = publicInfo?.theme_settings?.customFooterHtml || "";

  const innerStyle: CSSProperties = {
    maxWidth: "1440px",
    width: "100%",
    marginLeft: "auto",
    marginRight: "auto",
  };
  const innerClass = "box-border px-4 sm:px-6 lg:px-8";
  useEffect(() => {
    const fetchVersionInfo = async () => {
      try {
        const data = await call("common:getVersion");
        setVersionInfo({ hash: data.hash?.slice(0, 7), version: data.version });
      } catch (error) {
        setVersionFailed(true);
        console.error("Failed to fetch version info:", error);
      }
    };

    void fetchVersionInfo();
  }, [call]);

  return (
    <motion.div
      className="km-footer footer py-km-block border-t border-[var(--hub-border)]"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        y: MOTION_SPRING.soft,
        opacity: { duration: MOTION_DURATION.base, ease: MOTION_EASE.out },
      }}
    >
      {customFooterHtml ? (
        <Text
          size="1"
          color="gray"
          className={"flex flex-col justify-center items-center " + innerClass}
          style={innerStyle}
        >
          <span
            dangerouslySetInnerHTML={{
              __html: customFooterHtml,
            }}
          />
          <Text size="2" color="gray">
            Powered by PulseDeck
          </Text>
        </Text>
      ) : (
        <Flex
          direction={{ initial: "column", md: "row" }}
          justify="between"
          align={{ initial: "center", md: "center" }}
          gap="3"
          className={innerClass}
          style={innerStyle}
        >
          <Text size="2" color="gray">
            Powered by PulseDeck · Unified Observability Deck
          </Text>
          <Flex align="center" gap="3" wrap="wrap">
            {buildTime && (
              <Text size="1" color="gray" className="font-mono">
                Build {formatBuildTime(buildTime)}
              </Text>
            )}
            <Text size="1" color="gray" className="font-mono">
              <Skeletonize as="span" loading={!versionInfo && !versionFailed}>
                {versionInfo
                  ? `${versionInfo.version} (${versionInfo.hash})`
                  : versionFailed
                    ? null
                    : skeletonText(15)}
              </Skeletonize>
            </Text>
          </Flex>
        </Flex>
      )}
    </motion.div>
  );
};

export default Footer;
