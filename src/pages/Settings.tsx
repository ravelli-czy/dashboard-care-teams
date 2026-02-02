import React, { useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSettings } from "../lib/settings";
import { ThemeContext } from "../App";

const UI = {
  bg: "bg-slate-50 dark:bg-slate-900",
  card: "rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm",
  title: "text-slate-900 dark:text-white text-base font-semibold",
  subtitle: "text-slate-500 dark:text-slate-400 text-sm",
  label: "text-xs font-semibold text-slate-600 dark:text-slate-400",
  input:
    "mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:border-slate-400 dark:focus:border-slate-500",
  btn: "rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600",
  btnPrimary: "rounded-lg bg-blue-600 dark:bg-blue-500 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 dark:hover:bg-blue-600",
  chip: "inline-flex items-center gap-2 rounded-full border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 px-3 py-1 text-sm text-slate-700 dark:text-slate-300",
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


function uid(prefix = "shift") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function getCoverageShifts(settings: any): CoverageShift[] {
  const list = (settings as any)?.coverageShifts;
  if (Array.isArray(list) && list.length) return list as CoverageShift[];


// Fallback: persistimos coverageShifts por fuera del schema del settings (localStorage directo)
if (typeof window !== "undefined") {
  try {
    const raw = window.localStorage.getItem(COVERAGE_SHIFTS_LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed as CoverageShift[];
    }
  } catch {}
}

  const legacy = (settings as any)?.shifts;
  if (!legacy) return [];
  const mk = (id: string, name: string, color: string, start: string, end: string, days: number[]): CoverageShift => ({
    id, name, color, start, end, days, enabled: true,
  });

  const out: CoverageShift[] = [];
  if (legacy.morning) out.push(mk("morning", "Turno Mañana", "#22c55e", legacy.morning.start, legacy.morning.end, [0,1,2,3,4]));
  if (legacy.afternoon) out.push(mk("afternoon", "Turno Tarde", "#f59e0b", legacy.afternoon.start, legacy.afternoon.end, [0,1,2,3,4]));
  if (legacy.guard) out.push(mk("guard", "Turno Guardia", "#ef4444", legacy.guard.start, legacy.guard.end, [0,1,2,3,4,5,6]));
  return out;
}

function setCoverageShifts(settings: any, setSettings: any, shifts: CoverageShift[]) {
  // Guardamos en settings (si el schema lo permite) y también en localStorage directo (para no perderlo)
  setSettings({ ...(settings as any), coverageShifts: shifts } as any);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(COVERAGE_SHIFTS_LS_KEY, JSON.stringify(shifts));
    } catch {}
  }
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>;
}

export default function SettingsPage() {
  const { settings, setSettings, reset } = useSettings();
  const { theme, setTheme } = useContext(ThemeContext);

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

  return (
    <div className={UI.bg + " min-h-screen"}>
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
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Color: naranjo</div>
            </div>
          </div>

          <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Si TPP &gt; Al Límite → <span className="font-semibold">Warning</span> (rojo).
          </div>
        </div>

        <div className={UI.card + " mt-6 p-5"}>
          <div className={UI.title}>Dotación Histórica</div>
          <div className={UI.subtitle}>Ajusta la dotación según los rangos de fechas.</div>

          <Row>
            <div>
              <div className={UI.label}>Dotación Jun-2024 a Jun-2025</div>
              <input
                className={UI.input}
                type="number"
                value={settings.staffing.beforeJul2025}
                onChange={(e) => setSettings({ ...settings, staffing: { ...settings.staffing, beforeJul2025: Number(e.target.value) } })}
              />
            </div>
            <div>
              <div className={UI.label}>Dotación Jul-2025 en adelante</div>
              <input
                className={UI.input}
                type="number"
                value={settings.staffing.afterJul2025}
                onChange={(e) => setSettings({ ...settings, staffing: { ...settings.staffing, afterJul2025: Number(e.target.value) } })}
              />
            </div>
          </Row>
        </div>

        <div className={UI.card + " mt-6 p-5"}>
          <div className={UI.title}>Equipo (Personas)</div>
          <div className={UI.subtitle}>Define los miembros del equipo para métricas individuales.</div>

          <div className="mt-4 flex gap-2">
            <input
              className={UI.input + " flex-1"}
              placeholder="Nombre de la persona"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addTeam();
              }}
            />
            <button className={UI.btnPrimary} onClick={addTeam}>
              Agregar
            </button>
          </div>

          {teamSorted.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {teamSorted.map((name) => (
                <div key={name} className={UI.chip}>
                  <span>{name}</span>
                  <button
                    className="text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                    onClick={() => removeTeam(name)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

<div className={UI.card + " mt-6 p-5"}>
  <div className={UI.title}>Roles de Assignee</div>
  <div className={UI.subtitle}>
    Asigna roles a cada persona del universo de assignees. Los roles <span className="font-semibold">Guardia</span>,{" "}
    <span className="font-semibold">Agente</span> y <span className="font-semibold">Manager Care</span> se pueden incluir/excluir del análisis.
    El rol <span className="font-semibold">Ignorar</span> nunca se incluye.
  </div>

  <div className="mt-4 flex items-center gap-4 text-sm">
    <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
      <input
        type="checkbox"
        checked={roleInclusion.Guardia}
        onChange={(e) => setRoleInclusion("Guardia", e.target.checked)}
      />
      Incluir <span className="font-semibold">Guardia</span>
    </label>
    <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
      <input
        type="checkbox"
        checked={roleInclusion.Agente}
        onChange={(e) => setRoleInclusion("Agente", e.target.checked)}
      />
      Incluir <span className="font-semibold">Agente</span>
    </label>
    <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
      <input
        type="checkbox"
        checked={roleInclusion["Manager Care"]}
        onChange={(e) => setRoleInclusion("Manager Care", e.target.checked)}
      />
      Incluir <span className="font-semibold">Manager Care</span>
    </label>
  </div>

  {rolesUniverse.length > 0 && (
    <div className="mt-4 space-y-2">
      {rolesUniverse.map((assignee) => {
        const current = roleMap[assignee] || "Agente";
        return (
          <div key={assignee} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 p-3">
            <div className="text-sm font-medium text-slate-700 dark:text-slate-300">{assignee}</div>
            <select
              className="rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-sm text-slate-700 dark:text-slate-300"
              value={current}
              onChange={(e) => setAssigneeRole(assignee, e.target.value as AssigneeRole)}
            >
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
  )}
</div>

<div className={UI.card + " mt-6 p-5"}>
  <div className="flex items-start justify-between gap-3">
    <div>
      <div className={UI.title}>Horario del Team (Turnos)</div>
      <div className={UI.subtitle}>
        Define turnos con <span className="font-semibold">nombre</span> y <span className="font-semibold">color</span>. En el Dashboard,
        el heatmap mantiene el azul y se pinta solo el <span className="font-semibold">borde</span> según el primer turno que cubra cada celda.
        Si los turnos se solapan, se "unen" (se considera cubierto) y se usa el color del <span className="font-semibold">primer</span> turno (orden de la lista).
      </div>
    </div>

    <button
      className={UI.btnPrimary}
      onClick={() => {
        const current = getCoverageShifts(settings);
        const palette = ["#22c55e", "#f59e0b", "#a855f7", "#ef4444", "#14b8a6", "#0ea5e9"];
        const nextColor = palette[current.length % palette.length];
        const next: CoverageShift = {
          id: uid(),
          name: `Turno ${current.length + 1}`,
          color: nextColor,
          days: [0, 1, 2, 3, 4],
          start: "09:00",
          end: "18:00",
          enabled: true,
        };
        setCoverageShifts(settings, setSettings, [...current, next]);
      }}
    >
      + Agregar turno
    </button>
  </div>

  {(() => {
    const shifts = getCoverageShifts(settings);
    return (
      <div className="mt-4 space-y-3">
        {shifts.length === 0 ? (
          <div className="text-sm text-slate-500 dark:text-slate-400">Aún no hay turnos configurados.</div>
        ) : (
          shifts.map((sh, idx) => (
            <div key={sh.id} className="rounded-xl border border-slate-200 dark:border-slate-600 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: sh.color }} />
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">{sh.name}</div>
                  <label className="ml-2 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
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

                <div className="flex items-center gap-2">
                  <button
                    className={UI.btn}
                    disabled={idx === 0}
                    onClick={() => {
                      if (idx === 0) return;
                      const next = [...shifts];
                      const tmp = next[idx - 1];
                      next[idx - 1] = next[idx];
                      next[idx] = tmp;
                      setCoverageShifts(settings, setSettings, next);
                    }}
                    title="Subir prioridad"
                  >
                    ↑
                  </button>
                  <button
                    className={UI.btn}
                    disabled={idx === shifts.length - 1}
                    onClick={() => {
                      if (idx === shifts.length - 1) return;
                      const next = [...shifts];
                      const tmp = next[idx + 1];
                      next[idx + 1] = next[idx];
                      next[idx] = tmp;
                      setCoverageShifts(settings, setSettings, next);
                    }}
                    title="Bajar prioridad"
                  >
                    ↓
                  </button>
                  <button
                    className={UI.btn}
                    onClick={() => {
                      const next = shifts.filter((x) => x.id !== sh.id);
                      setCoverageShifts(settings, setSettings, next);
                    }}
                    title="Eliminar turno"
                  >
                    Eliminar
                  </button>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-12">
                <div className="md:col-span-5">
                  <div className={UI.label}>Nombre</div>
                  <input
                    className={UI.input}
                    value={sh.name}
                    onChange={(e) => {
                      const next = shifts.map((x) => (x.id === sh.id ? { ...x, name: e.target.value } : x));
                      setCoverageShifts(settings, setSettings, next);
                    }}
                  />
                </div>

                <div className="md:col-span-2">
                  <div className={UI.label}>Color</div>
                  <input
                    className={UI.input}
                    type="color"
                    value={sh.color || "#22c55e"}
                    onChange={(e) => {
                      const next = shifts.map((x) => (x.id === sh.id ? { ...x, color: e.target.value } : x));
                      setCoverageShifts(settings, setSettings, next);
                    }}
                  />
                </div>

                <div className="md:col-span-2">
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

                <div className="md:col-span-2">
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
                        <label key={d.idx} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const days = new Set(Array.isArray(sh.days) ? sh.days : []);
                              if (e.target.checked) days.add(d.idx);
                              else days.delete(d.idx);
                              const next = shifts.map((x) => (x.id === sh.id ? { ...x, days: Array.from(days).sort((a, b) => a - b) } : x));
                              setCoverageShifts(settings, setSettings, next);
                            }}
                          />
                          {d.label}
                        </label>
                      );
                    })}
                  </div>
                  <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    Si un turno cruza medianoche (ej. 22:00–06:00), se considera <span className="font-semibold">from&gt;to</span> y cubre ambos tramos.
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    );
  })()}
</div>


<div className="mt-6 text-xs text-slate-500 dark:text-slate-400">Los cambios se guardan automáticamente en tu navegador (localStorage).</div>
      </div>
    </div>
  );
}
