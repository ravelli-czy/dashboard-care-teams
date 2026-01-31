import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSettings } from "../lib/settings";

const UI = {
  bg: "bg-slate-50",
  card: "rounded-2xl border border-slate-200 bg-white shadow-sm",
  title: "text-slate-900 text-base font-semibold",
  subtitle: "text-slate-500 text-sm",
  label: "text-xs font-semibold text-slate-600",
  input:
    "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400",
  btn: "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50",
  btnPrimary: "rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700",
  chip: "inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm text-slate-700",
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
  normal: "#2563eb",
  guardia: "#f59e0b",
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
  if (legacy.guard) out.push(mk("guard", "Turno Guardia", "#ef4444", legacy.guard.start, legacy.guard.end, [0,1,2,3,4,5,6], "guardia"));
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
            <div className="text-2xl font-bold text-slate-900">Settings</div>
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
              <div className="mt-1 text-xs text-slate-500">Color: verde</div>
            </div>

            <div>
              <div className={UI.label}>Óptimo (hasta)</div>
              <input
                className={UI.input}
                type="number"
                value={settings.tpp.optimalMax}
                onChange={(e) => setSettings({ ...settings, tpp: { ...settings.tpp, optimalMax: Number(e.target.value) } })}
              />
              <div className="mt-1 text-xs text-slate-500">Color: azul</div>
            </div>

            <div>
              <div className={UI.label}>Al Límite (hasta)</div>
              <input
                className={UI.input}
                type="number"
                value={settings.tpp.limitMax}
                onChange={(e) => setSettings({ ...settings, tpp: { ...settings.tpp, limitMax: Number(e.target.value) } })}
              />
              <div className="mt-1 text-xs text-slate-500">Color: amarillo</div>
            </div>
          </div>

          <div className="mt-3 text-xs text-slate-500">Warning: mayor que “Al Límite” (color rojo)</div>
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
              <div className="text-sm text-slate-500">Sin integrantes aún.</div>
            ) : (
              teamSorted.map((name) => (
                <span key={name} className={UI.chip}>
                  {name}
                  <button className="text-slate-500 hover:text-slate-900" onClick={() => removeTeam(name)} aria-label={`Quitar ${name}`}>
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

  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
    <div className="text-sm font-semibold text-slate-900">Roles que cuentan para dotación</div>
    <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3 text-sm text-slate-700">
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
    <div className="mt-2 text-xs text-slate-500">
      Si marcas a alguien como <span className="font-semibold">Ignorar</span>, nunca contará para dotación (aunque aparezca como Asignado).
    </div>
  </div>

  <div className="mt-4">
    <div className="text-sm font-semibold text-slate-900">Asignados detectados en el CSV</div>
    <div className="text-xs text-slate-500">
      Esta lista se completa automáticamente al cargar un CSV en el Dashboard.
    </div>

    <div className="mt-3 space-y-2">
      {rolesUniverse.length === 0 ? (
        <div className="text-sm text-slate-500">Carga un CSV para listar Asignados y poder mapear roles.</div>
      ) : (
        rolesUniverse.map((name) => {
          const currentRole = (roleMap[name] || "Agente") as AssigneeRole;
          return (
            <div key={name} className="grid grid-cols-12 gap-2 items-center">
              <div className="col-span-8">
                <div className="text-sm font-semibold text-slate-800">{name}</div>
                <div className="text-xs text-slate-500">Asignado</div>
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
  <div className="flex items-start justify-between gap-3">
    <div>
      <div className={UI.title}>Horario del Team (Turnos)</div>
      <div className={UI.subtitle}>
        Define turnos con <span className="font-semibold">nombre</span> y <span className="font-semibold">tipo</span>. En el Dashboard,
        el heatmap mantiene el azul y se pinta el degradé según el turno que cubra cada celda: azul para <span className="font-semibold">Normal</span> y
        naranja para <span className="font-semibold">Guardia</span>. Si los turnos se solapan, se “unen” (se considera cubierto) y se usa el tipo del
        <span className="font-semibold">primer</span> turno (orden de la lista).
      </div>
    </div>

    <button
      className={UI.btnPrimary}
      onClick={() => {
        const current = getCoverageShifts(settings);
        const next: CoverageShift = {
          id: uid(),
          name: `Turno ${current.length + 1}`,
          color: SHIFT_KIND_COLORS.normal,
          days: [0, 1, 2, 3, 4],
          start: "09:00",
          end: "18:00",
          enabled: true,
          kind: "normal",
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
          <div className="text-sm text-slate-500">Aún no hay turnos configurados.</div>
        ) : (
          shifts.map((sh, idx) => (
            <div key={sh.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: sh.color }} />
                  <div className="text-sm font-semibold text-slate-900">{sh.name}</div>
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

                <div className="md:col-span-3">
                  <div className={UI.label}>Tipo de Turno</div>
                  <select
                    className={UI.input + " mt-0"}
                    value={sh.kind ?? "normal"}
                    onChange={(e) => {
                      const kind = e.target.value as CoverageShift["kind"];
                      const next = shifts.map((x) =>
                        x.id === sh.id
                          ? {
                              ...x,
                              kind,
                              color: SHIFT_KIND_COLORS[kind ?? "normal"],
                            }
                          : x
                      );
                      setCoverageShifts(settings, setSettings, next);
                    }}
                  >
                    <option value="normal">Turno Normal</option>
                    <option value="guardia">Turno Guardia</option>
                  </select>
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
                        <label key={d.idx} className="flex items-center gap-2 text-sm text-slate-700">
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
                  <div className="mt-2 text-xs text-slate-500">
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


<div className="mt-6 text-xs text-slate-500">Los cambios se guardan automáticamente en tu navegador (localStorage).</div>
      </div>
    </div>
  );
}
