import { LiveDataProvider } from "@/contexts/LiveDataContext";
import Footer from "../components/Footer";
import TopHeaderShell from "../components/hub/TopHeaderShell";
import { Outlet, useLocation } from "react-router-dom";
import { motion } from "motion/react";
import { SURFACE_MOTION } from "@/lib/motion";
import { useViewTransitionActive } from "@/lib/viewTransitionState";
import { RevealBoundary } from "@/components/motion/reveal";

const InnerLayout = () => {
  const location = useLocation();
  const viewTransitionActive = useViewTransitionActive();
  const routeSection = location.pathname.split("/").filter(Boolean)[0] ?? "overview";

  return (
    <div className="km-layout layout flex flex-col w-full min-h-screen bg-[var(--hub-canvas)] text-[var(--hub-ink)]">
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
