import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { arrayMove } from "@dnd-kit/sortable";
import type { DragEndEvent } from "@dnd-kit/core";
import { toast } from "sonner";
import { usePublicInfo } from "@/contexts/PublicInfoContext";
import { getMetricLabel } from "./catalog";
import { DASHBOARD_TEMPLATE_KEY } from "./constants";
import { parseDashboardTemplate } from "./dashboard";
import type { ChartSize, DashboardChart, MetricDefinition } from "./types";

const LOCAL_TEMPLATE_STORAGE_KEY = "pulsedeck.instance.chart_template";

const readLocalTemplate = () => {
  try {
    return localStorage.getItem(LOCAL_TEMPLATE_STORAGE_KEY);
  } catch {
    return null;
  }
};

/** 图表看板：卡片列表（由本地偏好或全局模板初始化）、增删改排序 */
export function useDashboard(definitionMap: Map<string, MetricDefinition>) {
  const { t } = useTranslation();
  const { publicInfo } = usePublicInfo();
  const globalDashboardTemplate =
    readLocalTemplate() ?? publicInfo?.theme_settings?.[DASHBOARD_TEMPLATE_KEY];
  // parseDashboardTemplate 已经返回规范化后的数组，后续所有变更保持未修改卡片的对象引用稳定
  const [charts, setCharts] = useState<DashboardChart[]>(() =>
    parseDashboardTemplate(globalDashboardTemplate),
  );
  const [savingGlobalTemplate, setSavingGlobalTemplate] = useState(false);

  const definitionMapRef = useRef(definitionMap);
  definitionMapRef.current = definitionMap;
  const chartsRef = useRef(charts);
  chartsRef.current = charts;

  useEffect(() => {
    setCharts(parseDashboardTemplate(globalDashboardTemplate));
  }, [globalDashboardTemplate]);

  const updateChart = useCallback(
    (id: string, updater: (chart: DashboardChart) => DashboardChart) => {
      setCharts((current) =>
        current.map((chart) => (chart.id === id ? updater(chart) : chart)),
      );
    },
    [],
  );

  const addChart = useCallback((metricKey: string) => {
    if (!metricKey) return;
    setCharts((current) => {
      const nextIndex = current.length + 1;
      const title = getMetricLabel(metricKey, definitionMapRef.current);
      return [
        ...current,
        {
          id: `custom-${Date.now()}`,
          title: title || `Chart ${nextIndex}`,
          metrics: [metricKey],
          size: "medium",
        },
      ];
    });
  }, []);

  const removeChart = useCallback((id: string) => {
    setCharts((current) => current.filter((chart) => chart.id !== id));
  }, []);

  const resetDashboard = useCallback(() => {
    setCharts(parseDashboardTemplate(globalDashboardTemplate));
  }, [globalDashboardTemplate]);

  const saveGlobalTemplate = useCallback(async () => {
    setSavingGlobalTemplate(true);
    try {
      localStorage.setItem(
        LOCAL_TEMPLATE_STORAGE_KEY,
        JSON.stringify(chartsRef.current, null, 2),
      );
      toast.success(t("chart.globalTemplateSaved", "已保存当前图表布局"));
    } catch (saveError) {
      toast.error(
        `${t("chart.globalTemplateSaveFailed", "保存失败")}: ${
          saveError instanceof Error ? saveError.message : String(saveError)
        }`,
      );
    } finally {
      setSavingGlobalTemplate(false);
    }
  }, [t]);

  const addMetric = useCallback(
    (chartId: string, metricKey: string) => {
      updateChart(chartId, (chart) => {
        if (!metricKey || chart.metrics.includes(metricKey)) return chart;
        return {
          ...chart,
          metrics: [...chart.metrics, metricKey],
        };
      });
    },
    [updateChart],
  );

  const removeMetric = useCallback(
    (chartId: string, metricKey: string) => {
      updateChart(chartId, (chart) => ({
        ...chart,
        metrics: chart.metrics.filter((item) => item !== metricKey),
      }));
    },
    [updateChart],
  );

  const setChartSize = useCallback(
    (chartId: string, size: ChartSize) => {
      updateChart(chartId, (chart) => (chart.size === size ? chart : { ...chart, size }));
    },
    [updateChart],
  );

  const handleChartDragEnd = useCallback(({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setCharts((current) => {
      const oldIndex = current.findIndex((chart) => chart.id === active.id);
      const newIndex = current.findIndex((chart) => chart.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return current;
      return arrayMove(current, oldIndex, newIndex);
    });
  }, []);

  return {
    charts,
    savingGlobalTemplate,
    saveGlobalTemplate,
    resetDashboard,
    addChart,
    removeChart,
    addMetric,
    removeMetric,
    setChartSize,
    handleChartDragEnd,
  };
}
