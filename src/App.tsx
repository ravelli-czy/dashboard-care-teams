import React, { createContext, useMemo, useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import DashboardPage from "./pages/Dashboard";
import SettingsPage from "./pages/Settings";
import { ThemeContext, ThemeMode } from "./lib/theme";

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
  const [theme, setTheme] = useState<ThemeMode>("light");

  const ctx = useMemo(() => ({ compare, setCompare }), [compare]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      <CompareSettingsContext.Provider value={ctx}>
        <BrowserRouter>
          <div className="bg-white min-h-screen">
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </div>
        </BrowserRouter>
      </CompareSettingsContext.Provider>
    </ThemeContext.Provider>
  );
}
