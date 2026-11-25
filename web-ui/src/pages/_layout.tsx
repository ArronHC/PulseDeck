import { LiveDataProvider } from "@/contexts/LiveDataContext";
import Footer from "../components/Footer";
import TopHeaderShell from "../components/hub/TopHeaderShell";
import { Outlet, useLocation } from "react-router-dom";
import { usePublicInfo } from "@/contexts/PublicInfoContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { motion } from "motion/react";
import { SURFACE_MOTION } from "@/lib/motion";
import { useViewTransitionActive } from "@/lib/viewTransitionState";
import { RevealBoundary } from "@/components/motion/reveal";

const InnerLayout = () => {
  const { publicInfo } = usePublicInfo();
  const isMobile = useIsMobile();
  const location = useLocation();
  const viewTransitionActive = useViewTransitionActive();
  const routeSection = location.pathname.split("/").filter(Boolean)[0] ?? "overview";
  const bgUrlDesktop = publicInfo?.theme_settings?.backgroundImageUrlDesktop;
  const bgUrlMobile = publicInfo?.theme_settings?.backgroundImageUrlMobile;
  const bgUrl = isMobile ? bgUrlMobile || bgUrlDesktop : bgUrlDesktop;

  return (
    <div
      className={
        bgUrl
          ? "km-layout layout flex flex-col w-full min-h-screen bg-cover bg-center bg-fixed bg-no-repeat text-[var(--hub-ink)]"
          : "km-layout layout flex flex-col w-full min-h-screen bg-[var(--hub-canvas)] text-[var(--hub-ink)]"
      }
      style={{
        backgroundImage: bgUrl ? `url(${bgUrl})` : "none",
        transition:
          "background-image var(--km-dur-slow) var(--km-ease-standard)",
      }}
    >
      <TopHeaderShell />

      <main className="km-main main-content flex-1 w-full max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6 box-border">
        <motion.div
          key={routeSection}
          initial={viewTransitionActive ? false : SURFACE_MOTION.route.initial}
          animate={SURFACE_MOTION.route.animate}
          transition={SURFACE_MOTION.route.transition}
        >
          <RevealBoundary>
            <Outlet />
          </RevealBoundary>
        </motion.div>
      </main>

      <Footer />
    </div>
  );
};

const IndexLayout = () => {
  return (
    <LiveDataProvider>
      <InnerLayout />
    </LiveDataProvider>
  );
};

export default IndexLayout;
