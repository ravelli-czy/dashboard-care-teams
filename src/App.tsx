import React, { createContext, useMemo, useState } from "react";
import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import DashboardPage from "./pages/Dashboard";
import SettingsPage from "./pages/Settings";
import { useSettings } from "./lib/settings";

export type DatasetBounds = { min: Date; max: Date } | null;

// Bandas para Tickets/Persona (TPP)
// Regla: se evalúan en orden; la primera que cumpla (tpp <= max) gana.
// La última debe tener max: null (∞).
export type TppBand = {
  id: string;
  label: string;
  max: number | null; // null = infinito
  color: string; // color semántico (por ahora fijo, luego backend)
};

export type CompareSettings = {
  comparePrevious: boolean;
  compareYoY: boolean;
  compareWindowMonths: 3 | 6 | 12;
  datasetBounds: DatasetBounds;

  // NUEVO: bandas para Tickets/Persona (TPP)
  tppBands: TppBand[];
};

export const CompareSettingsContext = createContext<{
  compare: CompareSettings;
  setCompare: React.Dispatch<React.SetStateAction<CompareSettings>>;
}>({
  compare: {
    comparePrevious: true,
    compareYoY: true,
    compareWindowMonths: 12,
    datasetBounds: null,
    tppBands: [
      { id: "cap", label: "Con Capacidad", max: 40, color: "#0052CC" },
      { id: "opt", label: "Óptimo", max: 70, color: "#36B37E" },
      { id: "lim", label: "Al Límite", max: 95, color: "#FFAB00" },
      { id: "war", label: "Warning", max: null, color: "#DE350B" },
    ],
  },
  setCompare: () => {},
});

const navLink =
  "rounded-md px-3 py-2 text-sm font-semibold text-[#42526E] hover:bg-[#F4F5F7]";
const navLinkActive =
  "rounded-md px-3 py-2 text-sm font-semibold text-[#172B4D] bg-white border border-[#DFE1E6] shadow-none";

export default function App() {
  const [compare, setCompare] = useState<CompareSettings>({
    comparePrevious: true,
    compareYoY: true,
    compareWindowMonths: 12,
    datasetBounds: null,

    // Nombres y colores fijos (a futuro backend)
    tppBands: [
      { id: "cap", label: "Con Capacidad", max: 40, color: "#0052CC" },
      { id: "opt", label: "Óptimo", max: 70, color: "#36B37E" },
      { id: "lim", label: "Al Límite", max: 95, color: "#FFAB00" },
      { id: "war", label: "Warning", max: null, color: "#DE350B" },
    ],
  });

  const ctx = useMemo(() => ({ compare, setCompare }), [compare]);
  const { settings } = useSettings();
  const dashboardLogo = (settings as any)?.dashboardLogo as string | undefined;

  return (
    <CompareSettingsContext.Provider value={ctx}>
      <BrowserRouter>
        <div className="bg-white min-h-screen">
          <div className="mx-auto max-w-7xl px-4 pt-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 text-sm font-semibold text-[#172B4D]">
                {dashboardLogo ? (
                  <img
                    src={dashboardLogo}
                    alt="Logo del Dashboard"
                    className="h-8 w-8 rounded-md border border-[#DFE1E6] bg-white object-contain"
                  />
                ) : null}
                <span>Support Performance</span>
              </div>
              <div className="flex items-center gap-2">
                <NavLink
                  to="/"
                  end
                  className={({ isActive }) =>
                    isActive ? navLinkActive : navLink
                  }
                >
                  Dashboard
                </NavLink>
                <NavLink
                  to="/settings"
                  className={({ isActive }) =>
                    isActive ? navLinkActive : navLink
                  }
                >
                  Settings
                </NavLink>
              </div>
            </div>
          </div>

          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </div>
      </BrowserRouter>
    </CompareSettingsContext.Provider>
  );
}
