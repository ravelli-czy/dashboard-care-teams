import { useEffect, useMemo, useState } from "react";

export type TeamShift = { start: string; end: string };

export type AppSettings = {
  tpp: { capacityMax: number; optimalMax: number; limitMax: number };
  team: string[];
  shifts: {
    morning: TeamShift;
    afternoon: TeamShift;
    guard: TeamShift;
  };
  dashboardLogo?: string;
};

const STORAGE_KEY = "janis-care-dashboard-settings:v1";

export const DEFAULT_SETTINGS: AppSettings = {
  tpp: { capacityMax: 40, optimalMax: 70, limitMax: 95 },
  team: [],
  shifts: {
    morning: { start: "08:00", end: "16:00" },
    afternoon: { start: "16:00", end: "00:00" },
    guard: { start: "00:00", end: "08:00" },
  },
  dashboardLogo: "",
};

function safeParseSettings(raw: string | null): AppSettings | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;

    const tpp = obj.tpp || {};
    const team = Array.isArray(obj.team) ? obj.team.filter((x: any) => typeof x === "string") : [];
    const shifts = obj.shifts || {};

    const merged: AppSettings = {
      ...DEFAULT_SETTINGS,
      tpp: {
        capacityMax: Number.isFinite(Number(tpp.capacityMax)) ? Number(tpp.capacityMax) : DEFAULT_SETTINGS.tpp.capacityMax,
        optimalMax: Number.isFinite(Number(tpp.optimalMax)) ? Number(tpp.optimalMax) : DEFAULT_SETTINGS.tpp.optimalMax,
        limitMax: Number.isFinite(Number(tpp.limitMax)) ? Number(tpp.limitMax) : DEFAULT_SETTINGS.tpp.limitMax,
      },
      team,
      shifts: {
        morning: {
          start: typeof shifts?.morning?.start === "string" ? shifts.morning.start : DEFAULT_SETTINGS.shifts.morning.start,
          end: typeof shifts?.morning?.end === "string" ? shifts.morning.end : DEFAULT_SETTINGS.shifts.morning.end,
        },
        afternoon: {
          start: typeof shifts?.afternoon?.start === "string" ? shifts.afternoon.start : DEFAULT_SETTINGS.shifts.afternoon.start,
          end: typeof shifts?.afternoon?.end === "string" ? shifts.afternoon.end : DEFAULT_SETTINGS.shifts.afternoon.end,
        },
        guard: {
          start: typeof shifts?.guard?.start === "string" ? shifts.guard.start : DEFAULT_SETTINGS.shifts.guard.start,
          end: typeof shifts?.guard?.end === "string" ? shifts.guard.end : DEFAULT_SETTINGS.shifts.guard.end,
        },
      },
      dashboardLogo: typeof obj.dashboardLogo === "string" ? obj.dashboardLogo : DEFAULT_SETTINGS.dashboardLogo,
    };

    if (merged.tpp.capacityMax > merged.tpp.optimalMax) merged.tpp.optimalMax = merged.tpp.capacityMax;
    if (merged.tpp.optimalMax > merged.tpp.limitMax) merged.tpp.limitMax = merged.tpp.optimalMax;

    return merged;
  } catch {
    return null;
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(() => {
    if (typeof window === "undefined") return DEFAULT_SETTINGS;
    try {
      const parsed = safeParseSettings(localStorage.getItem(STORAGE_KEY));
      return parsed ?? DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // ignore
    }
  }, [settings]);

  const api = useMemo(() => ({ settings, setSettings, reset: () => setSettings(DEFAULT_SETTINGS) }), [settings]);

  return api;
}
