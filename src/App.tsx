import React, { createContext, useMemo, useState } from "react";
import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import DashboardPage from "./pages/Dashboard";
import SettingsPage from "./pages/Settings";

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
      { id: "cap", label: "Con Capacidad", max: 40, color: "#0C66E4" },
      { id: "opt", label: "Óptimo", max: 70, color: "#22A06B" },
      { id: "lim", label: "Al Límite", max: 95, color: "#F5CD47" },
      { id: "war", label: "Warning", max: null, color: "#CA3521" },
    ],
  },
  setCompare: () => {},
});

const navLink =
  "rounded-md px-3 py-2 text-sm font-semibold text-[#42526E] hover:bg-[#F4F5F7]";
const navLinkActive =
  "rounded-md px-3 py-2 text-sm font-semibold text-[#172B4D] bg-white border border-[#DFE1E6] shadow-sm";

export default function App() {
  const [compare, setCompare] = useState<CompareSettings>({
    comparePrevious: true,
    compareYoY: true,
    compareWindowMonths: 12,
    datasetBounds: null,

    // Nombres y colores fijos (a futuro backend)
    tppBands: [
      { id: "cap", label: "Con Capacidad", max: 40, color: "#0C66E4" },
      { id: "opt", label: "Óptimo", max: 70, color: "#22A06B" },
      { id: "lim", label: "Al Límite", max: 95, color: "#F5CD47" },
      { id: "war", label: "Warning", max: null, color: "#CA3521" },
    ],
  });

  const ctx = useMemo(() => ({ compare, setCompare }), [compare]);

  return (
    <CompareSettingsContext.Provider value={ctx}>
      <BrowserRouter>
        <div className="bg-[#F4F5F7] min-h-screen">
          <div className="mx-auto max-w-7xl px-4 pt-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-[#172B4D]">
                Support Performance
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
