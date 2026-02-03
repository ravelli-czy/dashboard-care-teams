import React, { useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ThemeContext } from "../lib/theme";
import { useSettings } from "../lib/settings";


const UI = {
  bg: "bg-white",
  card: "rounded-md border border-[#DFE1E6] bg-white shadow-none",
  title: "text-[#172B4D] text-base font-semibold",
  subtitle: "text-[#5E6C84] text-sm",
  label: "text-xs font-semibold text-[#6B778C]",
  input:
    "mt-1 w-full rounded-md border border-[#DFE1E6] bg-white px-3 py-2 text-sm text-[#172B4D] outline-none focus:border-[#4C9AFF]",
  btn: "rounded-md border border-[#DFE1E6] bg-white px-3 py-2 text-sm text-[#42526E] hover:bg-[#F4F5F7]",
  btnPrimary: "rounded-md bg-[#0052CC] px-3 py-2 text-sm font-semibold text-white hover:bg-[#0747A6]",
  chip: "inline-flex items-center gap-2 rounded-full border border-[#DFE1E6] bg-[#F4F5F7] px-3 py-1 text-sm text-[#42526E]",
};


type AssigneeRole = "Guardia" | "Agente" | "Manager Care" | "Ignorar";
type RoleInclusion = { Guardia: boolean; Agente: boolean; "Manager Care": boolean };
const DEFAULT_ROLE_INCLUSION: RoleInclusion = { Guardia: true, Agente: true, "Manager Care": true };
const ROLE_OPTIONS: Array<{ value: AssigneeRole; label: string }> = [
  { value: "Agente", label: "Agente" },
  { value: "Guardia", label: "Guardia" },
  { value: "Manager Care", label: "Manager Care" },
  { value: "Ignorar", label: "Ignorar" },
];


type CoverageShift = {
  id: string;
  name: string;
  color: string; // hex
  days: number[]; // 0=Lun ... 6=Dom
  start: string; // "HH:MM"
  end: string;   // "HH:MM" (si start > end, cruza medianoche)
  enabled?: boolean;
  kind?: "normal" | "guardia";

};

const DAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"] as const;
const DAY_OPTIONS: Array<{ idx: number; label: string }> = DAY_LABELS.map((l, i) => ({ idx: i, label: l }));

const COVERAGE_SHIFTS_LS_KEY = "dashboardCare.coverageShifts.v1";
const SHIFT_KIND_COLORS: Record<NonNullable<CoverageShift["kind"]>, string> = {
  normal: "#0052CC",
  guardia: "#FFAB00",
};
const DEFAULT_SHIFT_LABELS: Record<NonNullable<CoverageShift["kind"]>, string> = {
  normal: "Turno Normal",
  guardia: "Turno Guardia",
};


function uid(prefix = "shift") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function normalizeCoverageShifts(shifts: CoverageShift[]): CoverageShift[] {
  return (shifts || []).map((shift) => {
    const kind: NonNullable<CoverageShift["kind"]> = shift.kind ?? "normal";
    return { ...shift, kind, color: SHIFT_KIND_COLORS[kind] };
  });
}

function getCoverageShifts(settings: any): CoverageShift[] {
  const list = (settings as any)?.coverageShifts;
  if (Array.isArray(list) && list.length) return normalizeCoverageShifts(list as CoverageShift[]);


// Fallback: persistimos coverageShifts por fuera del schema del settings (localStorage directo)
if (typeof window !== "undefined") {
  try {
    const raw = window.localStorage.getItem(COVERAGE_SHIFTS_LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return normalizeCoverageShifts(parsed as CoverageShift[]);
    }
  } catch {}
}

  const legacy = (settings as any)?.shifts;
  if (!legacy) return [];
  const mk = (
    id: string,
    name: string,
    color: string,
    start: string,
    end: string,
    days: number[],
    kind: CoverageShift["kind"] = "normal"
  ): CoverageShift => ({
    id,
    name,
    color,
    start,
    end,
    days,
    enabled: true,
    kind,
  });

  const out: CoverageShift[] = [];
  if (legacy.morning) out.push(mk("morning", "Turno Mañana", "#22c55e", legacy.morning.start, legacy.morning.end, [0,1,2,3,4], "normal"));
  if (legacy.afternoon) out.push(mk("afternoon", "Turno Tarde", "#f59e0b", legacy.afternoon.start, legacy.afternoon.end, [0,1,2,3,4], "normal"));
  if (legacy.guard) out.push(mk("guard", "Turno Guardia", "#f97316", legacy.guard.start, legacy.guard.end, [0,1,2,3,4,5,6], "guardia"));
  return normalizeCoverageShifts(out);
}

function setCoverageShifts(settings: any, setSettings: any, shifts: CoverageShift[]) {
  // Guardamos en settings (si el schema lo permite) y también en localStorage directo (para no perderlo)
  const normalized = normalizeCoverageShifts(shifts);
  setSettings({ ...(settings as any), coverageShifts: normalized } as any);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(COVERAGE_SHIFTS_LS_KEY, JSON.stringify(normalized));
    } catch {}
  }
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>;
}

export default function SettingsPage() {
  const { theme, setTheme } = useContext(ThemeContext);
  const { settings, setSettings, reset } = useSettings();

// Hydrate coverageShifts desde localStorage (por si el schema de settings descarta campos desconocidos)
useEffect(() => {
  if (typeof window === "undefined") return;
  const has = Array.isArray((settings as any)?.coverageShifts) && (settings as any).coverageShifts.length;
  if (has) return;
  try {
    const raw = window.localStorage.getItem(COVERAGE_SHIFTS_LS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) return;
    setSettings({ ...(settings as any), coverageShifts: parsed } as any);
  } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

  const [teamName, setTeamName] = useState("");

  const dashboardLogo = (settings as any)?.dashboardLogo as string | undefined;

  const teamSorted = useMemo(() => [...settings.team].sort((a, b) => a.localeCompare(b)), [settings.team]);

  const rolesUniverse = useMemo(() => {
    const u = ((settings as any).roles?.universe || []) as string[];
    return (Array.isArray(u) ? u : []).filter((x) => String(x || '').trim() !== '').sort((a, b) => a.localeCompare(b));
  }, [settings]);

  const roleInclusion: RoleInclusion = (((settings as any).roles?.inclusion || DEFAULT_ROLE_INCLUSION) as RoleInclusion);
  const roleMap: Record<string, AssigneeRole> = (((settings as any).roles?.map || {}) as Record<string, AssigneeRole>);

  const setRoleInclusion = (role: keyof RoleInclusion, checked: boolean) => {
    setSettings({
      ...(settings as any),
      roles: {
        universe: ((settings as any).roles?.universe || []),
        map: roleMap,
        inclusion: { ...roleInclusion, [role]: checked },
      },
    } as any);
  };

  const setAssigneeRole = (assignee: string, role: AssigneeRole) => {
    const key = String(assignee || '').trim();
    if (!key) return;
    setSettings({
      ...(settings as any),
      roles: {
        universe: ((settings as any).roles?.universe || []),
        inclusion: roleInclusion,
        map: { ...roleMap, [key]: role },
      },
    } as any);
  };


  const addTeam = () => {
    const v = teamName.trim();
    if (!v) return;
    if (settings.team.includes(v)) return;
    setSettings({ ...settings, team: [...settings.team, v] });
    setTeamName("");
  };

  const removeTeam = (name: string) => {
    setSettings({ ...settings, team: settings.team.filter((x) => x !== name) });
  };

  const shifts = getCoverageShifts(settings);
  const shiftLabels = {
    ...DEFAULT_SHIFT_LABELS,
    ...(((settings as any).shiftLabels || {}) as Partial<typeof DEFAULT_SHIFT_LABELS>),
  };

  const addShift = (kind: CoverageShift["kind"]) => {
    const current = getCoverageShifts(settings);
    const rangesForKind = current.filter((sh) => (sh.kind ?? "normal") === kind);
    const next: CoverageShift = {
      id: uid(),
      name: `Rango ${rangesForKind.length + 1}`,
      color: SHIFT_KIND_COLORS[kind ?? "normal"],
      days: kind === "guardia" ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4],
      start: kind === "guardia" ? "23:00" : "09:00",
      end: kind === "guardia" ? "06:00" : "18:00",
      enabled: true,
      kind,
    };
    setCoverageShifts(settings, setSettings, [...current, next]);
  };

  const renderShiftSection = (kind: CoverageShift["kind"], title: string, description: string) => {
    const sectionShifts = shifts.filter((sh) => (sh.kind ?? "normal") === kind);
    return (
      <div className="rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <span
                className={`shift-dot ${kind === "guardia" ? "shift-dot--guardia" : "shift-dot--normal"}`}
              />
              {title}
            </div>
            <div className="mt-1 text-xs text-slate-500">{description}</div>
          </div>
          <button className={UI.btnPrimary} onClick={() => addShift(kind)} aria-label={`Agregar rango ${title}`}>
            +
          </button>
        </div>

        <div className="mt-3">
          <div className={UI.label}>Nombre del tipo de turno</div>
          <input
            className={UI.input}
            value={shiftLabels[kind ?? "normal"]}
            onChange={(e) => {
              const nextLabels = { ...shiftLabels, [kind ?? "normal"]: e.target.value };
              setSettings({ ...(settings as any), shiftLabels: nextLabels } as any);
            }}
          />
        </div>

        <div className="mt-4 space-y-3">
          {sectionShifts.length === 0 ? (
            <div className="text-sm text-slate-500">Aún no hay rangos configurados.</div>
          ) : (
            sectionShifts.map((sh, idx) => (
              <div key={sh.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="text-sm font-semibold text-slate-900">{`Rango ${idx + 1}`}</div>
                    <label className="ml-2 flex items-center gap-2 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={sh.enabled !== false}
                        onChange={(e) => {
                          const next = shifts.map((x) => (x.id === sh.id ? { ...x, enabled: e.target.checked } : x));
                          setCoverageShifts(settings, setSettings, next);
                        }}
                      />
                      Activo
                    </label>
                  </div>

                  <button
                    className={UI.btn}
                    onClick={() => {
                      const next = shifts.filter((x) => x.id !== sh.id);
                      setCoverageShifts(settings, setSettings, next);
                    }}
                    title="Eliminar rango"
                  >
                    Eliminar
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-12">
                  <div className="md:col-span-6">
                    <div className={UI.label}>Inicio</div>
                    <input
                      className={UI.input}
                      type="time"
                      value={sh.start}
                      onChange={(e) => {
                        const next = shifts.map((x) => (x.id === sh.id ? { ...x, start: e.target.value } : x));
                        setCoverageShifts(settings, setSettings, next);
                      }}
                    />
                  </div>

                  <div className="md:col-span-6">
                    <div className={UI.label}>Fin</div>
                    <input
                      className={UI.input}
                      type="time"
                      value={sh.end}
                      onChange={(e) => {
                        const next = shifts.map((x) => (x.id === sh.id ? { ...x, end: e.target.value } : x));
                        setCoverageShifts(settings, setSettings, next);
                      }}
                    />
                  </div>

                  <div className="md:col-span-12">
                    <div className={UI.label}>Días</div>
                    <div className="mt-2 flex flex-wrap gap-3">
                      {DAY_OPTIONS.map((d) => {
                        const checked = Array.isArray(sh.days) && sh.days.includes(d.idx);
                        return (
                          <label key={d.idx} className="flex items-center gap-2 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const days = new Set(Array.isArray(sh.days) ? sh.days : []);
                                if (e.target.checked) days.add(d.idx);
                                else days.delete(d.idx);
                                const next = shifts.map((x) =>
                                  x.id === sh.id ? { ...x, days: Array.from(days).sort((a, b) => a - b) } : x
                                );
                                setCoverageShifts(settings, setSettings, next);
                              }}
                            />
                            {d.label}
                          </label>
                        );
                      })}
                    </div>
                    <div className="mt-2 text-xs text-slate-500">
                      Si un turno cruza medianoche (ej. 22:00–06:00), se considera <span className="font-semibold">from&gt;to</span> y cubre ambos tramos.
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={UI.bg + " min-h-screen"} data-theme={theme}>
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white">Settings</div>
            <div className={UI.subtitle}>Configura umbrales, equipo y turnos. Se aplica al Dashboard.</div>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/" className={UI.btn}>
              Volver al Dashboard
            </Link>
            <button className={UI.btn} onClick={reset}>
              Restaurar por defecto
            </button>
          </div>
        </div>

        {/* Sección de Tema */}
        <div className={UI.card + " mt-6 p-5"}>
          <div className={UI.title}>Apariencia</div>
          <div className={UI.subtitle}>Selecciona el tema de la interfaz.</div>
          
          <div className="mt-4 flex items-center gap-4">
            <button
              onClick={() => setTheme("light")}
              className={`flex items-center gap-2 rounded-lg border px-4 py-3 transition-all ${
                theme === "light"
                  ? "border-blue-600 dark:border-blue-500 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300"
                  : "border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600"
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              <span className="font-semibold text-sm">Claro</span>
            </button>
            
            <button
              onClick={() => setTheme("dark")}
              className={`flex items-center gap-2 rounded-lg border px-4 py-3 transition-all ${
                theme === "dark"
                  ? "border-blue-600 dark:border-blue-500 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300"
                  : "border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600"
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
              <span className="font-semibold text-sm">Oscuro</span>
            </button>
          </div>
        </div>

        <div className={UI.card + " mt-6 p-5"}>
          <div className={UI.title}>Dashboard</div>
          <div className={UI.subtitle}>Personaliza el logo que aparece junto al nombre del Dashboard.</div>

          <div className="mt-4 flex flex-wrap items-center gap-4">
            {dashboardLogo ? (
              <img src={dashboardLogo} alt="Logo del Dashboard" className="h-10 w-10 rounded-md object-contain border border-slate-200 bg-white" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-md border border-dashed border-slate-300 text-xs text-slate-400">
                Logo
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <label className={UI.btnPrimary + " cursor-pointer"}>
                Subir logo
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      const result = typeof reader.result === "string" ? reader.result : "";
                      if (!result) return;
                      setSettings({ ...(settings as any), dashboardLogo: result } as any);
                    };
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
              {dashboardLogo ? (
                <button
                  className={UI.btn}
                  onClick={() => setSettings({ ...(settings as any), dashboardLogo: "" } as any)}
                >
                  Quitar logo
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className={UI.card + " mt-6 p-5"}>
          <div className={UI.title}>Dashboard</div>
          <div className={UI.subtitle}>Personaliza el logo que aparece junto al nombre del Dashboard.</div>

          <div className="mt-4 flex flex-wrap items-center gap-4">
            {dashboardLogo ? (
              <img src={dashboardLogo} alt="Logo del Dashboard" className="h-10 w-10 rounded-md object-contain border border-slate-200 bg-white" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-md border border-dashed border-slate-300 text-xs text-slate-400">
                Logo
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <label className={UI.btnPrimary + " cursor-pointer"}>
                Subir logo
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      const result = typeof reader.result === "string" ? reader.result : "";
                      if (!result) return;
                      setSettings({ ...(settings as any), dashboardLogo: result } as any);
                    };
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
              {dashboardLogo ? (
                <button
                  className={UI.btn}
                  onClick={() => setSettings({ ...(settings as any), dashboardLogo: "" } as any)}
                >
                  Quitar logo
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className={UI.card + " mt-6 p-5"}>
          <div className={UI.title}>Dashboard</div>
          <div className={UI.subtitle}>Personaliza el logo que aparece junto al nombre del Dashboard.</div>

          <div className="mt-4 flex flex-wrap items-center gap-4">
            {dashboardLogo ? (
              <img src={dashboardLogo} alt="Logo del Dashboard" className="h-10 w-10 rounded-md object-contain border border-slate-200 bg-white" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-md border border-dashed border-slate-300 text-xs text-slate-400">
                Logo
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <label className={UI.btnPrimary + " cursor-pointer"}>
                Subir logo
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      const result = typeof reader.result === "string" ? reader.result : "";
                      if (!result) return;
                      setSettings({ ...(settings as any), dashboardLogo: result } as any);
                    };
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
              {dashboardLogo ? (
                <button
                  className={UI.btn}
                  onClick={() => setSettings({ ...(settings as any), dashboardLogo: "" } as any)}
                >
                  Quitar logo
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className={UI.card + " mt-6 p-5"}>
          <div className={UI.title}>Tickets x Persona</div>
          <div className={UI.subtitle}>Define umbrales para clasificar el indicador y mostrar su etiqueta/color.</div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <div className={UI.label}>Con Capacidad (menor que)</div>
              <input
                className={UI.input}
                type="number"
                value={settings.tpp.capacityMax}
                onChange={(e) => setSettings({ ...settings, tpp: { ...settings.tpp, capacityMax: Number(e.target.value) } })}
              />
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Color: verde</div>
            </div>

            <div>
              <div className={UI.label}>Óptimo (hasta)</div>
              <input
                className={UI.input}
                type="number"
                value={settings.tpp.optimalMax}
                onChange={(e) => setSettings({ ...settings, tpp: { ...settings.tpp, optimalMax: Number(e.target.value) } })}
              />
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Color: azul</div>
            </div>

            <div>
              <div className={UI.label}>Al Límite (hasta)</div>
              <input
                className={UI.input}
                type="number"
                value={settings.tpp.limitMax}
                onChange={(e) => setSettings({ ...settings, tpp: { ...settings.tpp, limitMax: Number(e.target.value) } })}
              />
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Color: amarillo</div>
            </div>
          </div>

          <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">Warning: mayor que "Al Límite" (color rojo)</div>
        </div>

        <div className={UI.card + " mt-6 p-5"}>
          <div className={UI.title}>Team</div>
          <div className={UI.subtitle}>
            Agrega o quita integrantes. Coincidencia por <span className="font-semibold">Nombre exacto</span>. En Top 10 Asignados:
            Team = azul / fuera de Team = amarillo.
          </div>

          <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-end">
            <div className="flex-1">
              <div className={UI.label}>Nombre exacto</div>
              <input className={UI.input} value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Ej: Joel Lechuga" />
            </div>
            <button className={UI.btnPrimary} onClick={addTeam}>
              Agregar
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {teamSorted.length === 0 ? (
              <div className="text-sm text-slate-500 dark:text-slate-400">Sin integrantes aún.</div>
            ) : (
              teamSorted.map((name) => (
                <span key={name} className={UI.chip}>
                  {name}
                  <button className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white" onClick={() => removeTeam(name)} aria-label={`Quitar ${name}`}>
                    ×
                  </button>
                </span>
              ))
            )}
          </div>
        </div>

        
<div className={UI.card + " mt-6 p-5"}>
  <div className={UI.title}>Dotación (Roles por Asignado)</div>
  <div className={UI.subtitle}>
    El Dashboard calcula dotación por mes usando el campo <span className="font-semibold">Asignado</span>: si una persona aparece en un ticket creado en un mes,
    se considera parte de la dotación de ese mes. Aquí defines el rol de cada Asignado y qué roles cuentan para el KPI.
  </div>

  <div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 p-4">
    <div className="text-sm font-semibold text-slate-900 dark:text-white">Roles que cuentan para dotación</div>
    <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3 text-sm text-slate-700 dark:text-slate-300">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={!!roleInclusion.Agente} onChange={(e) => setRoleInclusion("Agente", e.target.checked)} />
        Agente
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={!!roleInclusion.Guardia} onChange={(e) => setRoleInclusion("Guardia", e.target.checked)} />
        Guardia
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={!!roleInclusion["Manager Care"]}
          onChange={(e) => setRoleInclusion("Manager Care", e.target.checked)}
        />
        Manager Care
      </label>
    </div>
    <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
      Si marcas a alguien como <span className="font-semibold">Ignorar</span>, nunca contará para dotación (aunque aparezca como Asignado).
    </div>
  </div>

  <div className="mt-4">
    <div className="text-sm font-semibold text-slate-900 dark:text-white">Asignados detectados en el CSV</div>
    <div className="text-xs text-slate-500 dark:text-slate-400">
      Esta lista se completa automáticamente al cargar un CSV en el Dashboard.
    </div>

    <div className="mt-3 space-y-2">
      {rolesUniverse.length === 0 ? (
        <div className="text-sm text-slate-500 dark:text-slate-400">Carga un CSV para listar Asignados y poder mapear roles.</div>
      ) : (
        rolesUniverse.map((name) => {
          const currentRole = (roleMap[name] || "Agente") as AssigneeRole;
          return (
            <div key={name} className="grid grid-cols-12 gap-2 items-center">
              <div className="col-span-8">
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">{name}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Asignado</div>
              </div>
              <div className="col-span-4">
                <select
                  className={UI.input + " mt-0"}
                  value={currentRole}
                  onChange={(e) => setAssigneeRole(name, e.target.value as AssigneeRole)}
                >
                  {ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          );
        })
      )}
    </div>
  </div>
</div>


<div className={UI.card + " mt-6 p-5"}>
  <div className={UI.title}>Horario del Team (Turnos)</div>
  <div className={UI.subtitle}>
    Configura solo dos tipos de horario: <span className="font-semibold">Normal</span> y <span className="font-semibold">Guardia</span>. Dentro de cada uno
    puedes agregar múltiples rangos horarios. En el Dashboard, el heatmap mantiene el azul y se pinta el degradé según el turno que cubra cada celda:
    azul para Normal y naranja para Guardia. Si los turnos se solapan, se “unen” (se considera cubierto) y se usa el tipo del primer rango.
  </div>

  <div className="mt-4 space-y-4">
    {renderShiftSection("normal", "Turno Normal", "Rangos para el horario habitual del equipo.")}
    {renderShiftSection("guardia", "Turno Guardia", "Rangos para la cobertura fuera de horario o guardias.")}
  </div>
</div>


<div className="mt-6 text-xs text-slate-500 dark:text-slate-400">Los cambios se guardan automáticamente en tu navegador (localStorage).</div>
      </div>
    </div>
  );
}
