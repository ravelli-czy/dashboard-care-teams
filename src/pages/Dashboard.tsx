import React, { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import { useSettings } from "../lib/settings";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Janis Commerce - Care Executive Dashboard (React)
 *
 * Reglas importantes:
 * - Fechas: 19/ene/26 12:47 PM (meses en español)
 * - SLA Response: Cumplido si valor >= 0 o vacío. Incumplido solo si valor < 0.
 *   (Incluye 0, 0:00, 00:00 como Cumplido.)
 * - Columna SLA a considerar: "Campo personalizado (Time to first response)" (con o sin punto final).
 * - Organizaciones: basarse en "Campo personalizado (Organizations)"
 * - Excluir estados Block/Hold del conteo
 * - Dotación: 5 personas (Jun-2024 a Jun-2025), 3 personas (Jul-2025+)
 */

// --- UI (estilo similar al screenshot) ---
const UI = {
  pageBg: "bg-[#eef2f7]",
  card: "bg-white border border-slate-200 rounded-xl shadow-none",
  title: "text-sm font-semibold text-slate-700",
  subtle: "text-xs text-slate-500",
  primary: "#2563eb", // azul principal (no-SLA y SLA cumplido)
  primaryLight: "#60a5fa",
  warning: "#f97316", // naranjo (SLA incumplido)
  danger: "#ef4444",
  ok: "#22c55e",
  grid: "#e5e7eb",
};


type AssigneeRole = "Guardia" | "Agente" | "Manager Care" | "Ignorar";
type RoleInclusion = { Guardia: boolean; Agente: boolean; "Manager Care": boolean };

const DEFAULT_ROLE_INCLUSION: RoleInclusion = { Guardia: true, Agente: true, "Manager Care": true };

function getRoleSettings(settings: any) {
  const roles = (settings as any)?.roles || {};
  const inclusion = (roles.inclusion || DEFAULT_ROLE_INCLUSION) as RoleInclusion;
  const map = (roles.map || {}) as Record<string, AssigneeRole>;
  const universe = Array.isArray(roles.universe) ? (roles.universe as string[]) : [];
  return { inclusion, map, universe };
}

function roleIncluded(role: AssigneeRole, inclusion: RoleInclusion) {
  if (role === "Ignorar") return false;
  if (role === "Guardia") return !!inclusion.Guardia;
  if (role === "Manager Care") return !!inclusion["Manager Care"];
  return !!inclusion.Agente; // Agente
}

const PIE_COLORS = [
  "#2563eb",
  "#60a5fa",
  "#1d4ed8",
  "#93c5fd",
  "#3b82f6",
  "#94a3b8", // Otros
];

function coalesce(a: any, b: any) {
  return a === null || a === undefined ? b : a;
}

function hexToRgb(hex: string) {
  const h = String(hex || "").replace("#", "").trim();
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (![r, g, b].every((x) => Number.isFinite(x))) return null;
  return { r, g, b };
}

// Blanco -> Azul más oscuro (según repetición)
function heatBg(count: number, max: number, color: string = UI.primary) {
  if (!count || !max) return { backgroundColor: "#ffffff", color: "#0f172a" };
  const rgb = hexToRgb(color) || { r: 37, g: 99, b: 235 };
  const ratio = Math.max(0, Math.min(1, count / max));
  const alpha = 0.06 + ratio * 0.82;
  const bg = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
  const text = alpha > 0.55 ? "#ffffff" : "#0f172a";
  return { backgroundColor: bg, color: text };
}

function normalizeCoverageShifts(shifts: CoverageShift[]): CoverageShift[] {
  return (shifts || []).map((shift) => {
    const kind: NonNullable<CoverageShift["kind"]> = shift.kind ?? "normal";
    return { ...shift, kind, color: SHIFT_KIND_COLORS[kind] };
  });
}


// --- Cobertura (turnos) para pintar bordes en heatmaps ---
// Nota: el color solo se usa para el BORDE/outline. El azul del heatmap se mantiene.
const COVERAGE_SHIFTS_LS_KEY = "dashboardCare.coverageShifts.v1";
const DASHBOARD_ROWS_LS_KEY = "dashboardCare.csvRows.v1";

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
const DAY_TO_IDX: Record<string, number> = {
  Lun: 0, Mar: 1, Mié: 2, Jue: 3, Vie: 4, Sáb: 5, Dom: 6,
};
const SHIFT_KIND_COLORS: Record<NonNullable<CoverageShift["kind"]>, string> = {
  normal: "#2563eb",
  guardia: "#f97316",
};

function timeToMinutes(t: string) {
  const [hh, mm] = String(t || "").split(":");
  const h = Number(hh);
  const m = Number(mm);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

// hour: 0..23
function shiftCoversHour(shift: CoverageShift, hour: number) {
  const s = timeToMinutes(shift.start);
  const e = timeToMinutes(shift.end);
  if (s === null || e === null) return false;
  const h0 = hour * 60;
  const h1 = hour * 60 + 59; // incluir la hora completa
  if (s === e) return false; // 0 duración
  if (s < e) {
    return h0 >= s && h1 < e;
  }
  // cruza medianoche (start > end)
  return (h0 >= s && h1 < 24 * 60) || (h0 >= 0 && h1 < e);
}

function shiftCoversDayHour(shift: CoverageShift, dayIdx: number, hour: number) {
  if (!Array.isArray(shift.days) || !shift.days.includes(dayIdx)) return false;
  return shiftCoversHour(shift, hour);
}

function getCoverageShifts(settings: any): CoverageShift[] {
  const list = (settings as any)?.coverageShifts;
  if (Array.isArray(list) && list.length) return normalizeCoverageShifts(list as CoverageShift[]);


// Fallback: leer coverageShifts directo desde localStorage (por si el schema de settings los descarta)
if (typeof window !== "undefined") {
  try {
    const raw = window.localStorage.getItem(COVERAGE_SHIFTS_LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return normalizeCoverageShifts(parsed as CoverageShift[]);
    }
  } catch {}
}

  // Compatibilidad: si venías usando settings.shifts (morning/afternoon/guard)
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
  if (legacy.afternoon) out.push(mk("afternoon", "Turno Tarde", "#22c55e", legacy.afternoon.start, legacy.afternoon.end, [0,1,2,3,4], "normal"));
  if (legacy.guard) out.push(mk("guard", "Turno Guardia", "#f97316", legacy.guard.start, legacy.guard.end, [0,1,2,3,4,5,6], "guardia"));
  return normalizeCoverageShifts(out);
}

// Regla: si hay solape, se “une” (igual es cobertura). Visualmente se toma el color del PRIMER turno que calza.
function pickShiftForHour(shifts: CoverageShift[], hour: number) {
  for (const sh of shifts) {
    if (sh.enabled === false) continue;
    if (shiftCoversHour(sh, hour)) return sh;
  }
  return null;
}

function pickShiftForDayHour(shifts: CoverageShift[], dayIdx: number, hour: number) {
  for (const sh of shifts) {
    if (sh.enabled === false) continue;
    if (shiftCoversDayHour(sh, dayIdx, hour)) return sh;
  }
  return null;
}

function hexToRgba(hex: string, alpha: number) {
  const h = hex.replace("#", "");
  const bigint = parseInt(h, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Overlay suave para marcar cobertura (sin bordes), sin romper el azul del heatmap
function getShiftOverlayStyle(color?: string): React.CSSProperties {
  if (!color) return {};
  return { backgroundColor: hexToRgba(color, 0.18) };
}

// Para colorear encabezados por día: primer turno que incluya ese día (orden Settings)
function pickShiftForDay(shifts: any[], dayIdx: number) {
  for (const sh of shifts || []) {
    if (sh?.enabled === false) continue;
    if (Array.isArray(sh?.days) && sh.days.includes(dayIdx)) return sh;
  }
  return null;
}


function ShiftsLegend({ shifts }: { shifts: CoverageShift[] }) {
  const items = (shifts || []).filter((s) => s && s.enabled !== false);
  if (!items.length) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {items.map((s) => (
        <span
          key={s.id}
          className="inline-flex items-center gap-2 rounded-full bg-white px-2.5 py-1 text-xs text-slate-700"
          title={s.name}
        >
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color || "#94a3b8" }} />
          {s.name}
        </span>
      ))}
    </div>
  );
}

const MONTH_MAP: Record<string, string> = {
  ene: "Jan",
  feb: "Feb",
  mar: "Mar",
  abr: "Apr",
  may: "May",
  jun: "Jun",
  jul: "Jul",
  ago: "Aug",
  sep: "Sep",
  oct: "Oct",
  nov: "Nov",
  dic: "Dec",
};

function normalizeSpanishMonth(dateStr: string) {
  if (!dateStr) return "";
  return String(dateStr).replace(
    /\/(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)\//gi,
    (m) => {
      const key = m.split("/").join("").toLowerCase();
      const repl = MONTH_MAP[key] || key;
      return `/${repl}/`;
    }
  );
}

function parseCreated(dateStr: string) {
  if (!dateStr) return null;
  const en = normalizeSpanishMonth(dateStr).trim();

  // Example: 19/Jan/26 12:47 PM
  const match = en.match(
    /^(\d{1,2})\/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\/(\d{2})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i
  );
  if (!match) return null;

  const dd = Number(match[1]);
  const mon = match[2];
  const yy = Number(match[3]);
  const hh = Number(match[4]);
  const mm = Number(match[5]);
  const ampm = String(match[6]).toUpperCase();

  const year = yy >= 70 ? 1900 + yy : 2000 + yy;
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const monthIndex = months.indexOf(
    mon[0].toUpperCase() + mon.slice(1).toLowerCase()
  );
  if (monthIndex < 0) return null;

  let hour = hh;
  if (ampm === "PM" && hour !== 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;

  const d = new Date(year, monthIndex, dd, hour, mm, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

function ym(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function teamSizeForMonth(monthStr: string) {
  if (!monthStr || !monthStr.includes("-")) return null;
  const parts = monthStr.split("-");
  if (parts.length !== 2) return null;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return null;

  // Jun 2024 to Jun 2025 inclusive => 5
  const inFive =
    (y > 2024 || (y === 2024 && m >= 6)) &&
    (y < 2025 || (y === 2025 && m <= 6));
  if (inFive) return 5;

  // Jul 2025 onward => 3
  const inThree = y > 2025 || (y === 2025 && m >= 7);
  if (inThree) return 3;

  return null;
}

function parseSlaHours(s: any) {
  if (s == null) return null;
  const str = String(s).trim();
  if (!str) return null;

  // Numeric (e.g., 1.25, -2, -2,5)
  const numRe = new RegExp("^[+-]?\\d+(?:[\\.,]\\d+)?$");
  if (numRe.test(str)) {
    const num = Number(str.replace(",", "."));
    return Number.isFinite(num) ? num : null;
  }

  // HH:MM with optional sign (e.g., -0:30)
  const hmRe = new RegExp("^([+-])?(\\d+)\\s*:\\s*(\\d{1,2})$");
  const match = str.match(hmRe);
  if (!match) return null;

  const signChar = match[1] || "+";
  const hoursAbs = Number(match[2]);
  const minutesAbs = Number(match[3]);
  if (!Number.isFinite(hoursAbs) || !Number.isFinite(minutesAbs)) return null;

  const val = hoursAbs + minutesAbs / 60;
  return signChar === "-" ? -val : val;
}

function pct(n: number, d: number) {
  if (!d) return 0;
  return (n / d) * 100;
}

function formatInt(n: any) {
  return new Intl.NumberFormat("es-CL").format(Number(n) || 0);
}

function formatPct(n: any) {
  const val = Number(n) || 0;
  return `${val.toFixed(2)}%`;
}

function formatDateCLShort(d: Date) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

function escapeHtml(s: any) {
  const str = String(s ?? "");
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function monthLabel(m: string) {
  // m = YYYY-MM
  if (!m || !m.includes("-")) return m;
  const [y, mm] = m.split("-");
  const names = [
    "Ene",
    "Feb",
    "Mar",
    "Abr",
    "May",
    "Jun",
    "Jul",
    "Ago",
    "Sep",
    "Oct",
    "Nov",
    "Dic",
  ];
  const idx = Number(mm) - 1;
  const n = idx >= 0 && idx < 12 ? names[idx] : mm;
  return `${n} ${y}`;
}

function getField(row: Record<string, any>, candidates: string[]) {
  for (const c of candidates) {
    const v = row[c];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  for (const c of candidates) {
    if (Object.prototype.hasOwnProperty.call(row, c)) return row[c];
  }
  return undefined;
}

function pieTooltipFormatterFactory(
  data: Array<{ name: string; tickets: number }>
) {
  return (value: any, _name: any, props: any) => {
    const v = Number(value) || 0;
    const total = (data || []).reduce(
      (s, x) => s + (Number(x.tickets) || 0),
      0
    );
    const p = total ? (v / total) * 100 : 0;
    const label =
      props && props.payload && props.payload.name ? props.payload.name : "";
    return [`${formatInt(v)} (${p.toFixed(2)}%)`, label];
  };
}

async function exportExecutivePdfDirect(args: {
  html: string;
  filename: string;
}) {
  let iframe: HTMLIFrameElement | null = null;

  try {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import("html2canvas"),
      import("jspdf"),
    ]);

    iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.left = "-10000px";
    iframe.style.top = "0";
    iframe.style.width = "794px"; // A4 @ 96dpi aprox
    iframe.style.height = "1123px";
    iframe.style.border = "0";
    iframe.style.background = "#eef2f7";
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument;
    if (!doc) throw new Error("No se pudo inicializar el documento para exportar.");

    doc.open();
    doc.write(args.html);
    doc.close();

    // Espera a que el layout se estabilice
    await new Promise<void>((resolve) => setTimeout(resolve, 600));

    // Espera a que carguen fuentes si el navegador lo soporta
    try {
      // @ts-ignore
      if (doc.fonts && doc.fonts.ready) {
        // @ts-ignore
        await doc.fonts.ready;
      }
    } catch {
      // ignore
    }

    const target = doc.documentElement;

    const canvas = await html2canvas(target, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#eef2f7",
      windowWidth: 794,
    });

    const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });

    const pageWidth = 210;
    const pageHeight = 297;
    const margin = 8;
    const contentW = pageWidth - margin * 2;
    const contentH = pageHeight - margin * 2;

    const pxPerMm = canvas.width / contentW;
    const slicePx = Math.floor(contentH * pxPerMm);

    let sy = 0;
    let page = 0;
    while (sy < canvas.height) {
      if (page > 0) pdf.addPage();

      const sh = Math.min(slicePx, canvas.height - sy);
      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = canvas.width;
      pageCanvas.height = sh;
      const ctx = pageCanvas.getContext("2d");
      if (!ctx) break;

      ctx.drawImage(canvas, 0, sy, canvas.width, sh, 0, 0, canvas.width, sh);

      const pageImg = pageCanvas.toDataURL("image/jpeg", 0.92);
      const imgH = (sh * contentW) / canvas.width;

      pdf.addImage(pageImg, "JPEG", margin, margin, contentW, imgH);

      sy += sh;
      page += 1;
    }

    // ✅ Descarga directa (más confiable que anchor+blob en algunos navegadores/entornos)
    try {
      pdf.save(args.filename);
      return;
    } catch (e) {
      console.warn("pdf.save() falló, usando fallback blob", e);
    }

    // Fallback: blob + anchor
    const blob: Blob = pdf.output("blob");
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = args.filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();

    // Fallback extra: abrir en una pestaña si el navegador bloquea la descarga
    setTimeout(() => {
      try {
        window.open(url, "_blank", "noopener,noreferrer");
      } catch {
        // ignore
      }
    }, 250);

    setTimeout(() => URL.revokeObjectURL(url), 8000);
  } catch (e: any) {
    console.error("Export PDF failed", e);
    const msg = (e && (e.message || e.toString())) || "Error exportando PDF";
    throw new Error(msg);
  } finally {
    if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
  }
}

function buildExecutiveReportHtml(args: {
  title: string;
  generatedAt: Date;
  filters: {
    fromMonth: string;
    toMonth: string;
    org: string;
    assignee: string;
    status: string;
  };
  autoRange: { minMonth: string | null; maxMonth: string | null };
  kpis: {
    total: number;
    latestMonth: string | null;
    monthCount: number;
    respInc: number;
    respOkPct: number;
    csatAvg: number | null;
    csatCoverage: number;
    tpp6m: number | null;
    tppHealth: { label: string };
  };
  series: {
    ticketsByMonth: Array<{ month: string; tickets: number }>;
    ticketsByYear: Array<{ year: string; tickets: number }>;
    slaByYear: Array<{
      year: string;
      Cumplido: number;
      Incumplido: number;
      CumplidoPct: number;
      IncumplidoPct: number;
    }>;
    csatByYear: Array<{ year: string; csatAvg: number | null; responses: number }>;
    topAssignees: Array<{ name: string; tickets: number }>;
    topOrgsPie: Array<{ name: string; tickets: number }>;
    heatMap: { states: string[]; rows: any[]; range: string };
    hourHeatMap: { data: Array<{ hour: number; tickets: number }>; max: number };
    weekHeatMap: { days: string[]; matrix: any[]; max: number };
  };
}) {
  const { title, generatedAt, filters, autoRange, kpis, series } = args;
  const f = (v: any) => escapeHtml(v);
  const fmtInt = (n: any) => new Intl.NumberFormat("es-CL").format(Number(n) || 0);
  const fmtShort = (n: number) => {
    const v = Number(n) || 0;
    if (Math.abs(v) >= 1_000_000) return (v/1_000_000).toFixed(1) + "M";
    if (Math.abs(v) >= 1_000) return (v/1_000).toFixed(1) + "k";
    return String(Math.round(v));
  };
  const fmtPct = (n: any) => `${(Number(n) || 0).toFixed(2)}%`;

  const gen = generatedAt;
  const genStr = `${gen.getFullYear()}-${String(gen.getMonth() + 1).padStart(2, "0")}-${String(
    gen.getDate()
  ).padStart(2, "0")} ${String(gen.getHours()).padStart(2, "0")}:${String(
    gen.getMinutes()
  ).padStart(2, "0")}`;

  // ===== Styles (match screenshot / dashboard) =====
  const bg = "#eef2f7";
  const cardBorder = "#e5eef7";
  const textDark = "#0f172a";
  const textMuted = "#64748b";
  const blue = UI.primary; // #2563eb
  const blue2 = UI.primaryLight; // #60a5fa
  const warn = UI.warning; // #f97316
  const grid = "#e6edf6";
  const green = UI.ok; // #22c55e

  const filterLine = [
    `Archivo: ${f(autoRange.minMonth || "—")} → ${f(autoRange.maxMonth || "—")}`,
    `Vista: ${f(filters.fromMonth)} → ${f(filters.toMonth)}`,
    `Org: ${f(filters.org)}`,
    `Asignado: ${f(filters.assignee)}`,
    `Estado: ${f(filters.status)}`,
  ].join(" • ");

  const kpiItems = [
    { label: "Tickets (vista)", value: fmtInt(kpis.total), note: "" },
    {
      label: "Tickets último mes (vista)",
      value: fmtInt(kpis.monthCount),
      note: kpis.latestMonth ? monthLabel(kpis.latestMonth) : "—",
    },
    {
      label: "SLA Respuesta",
      value: fmtPct(kpis.respOkPct),
      note: `${fmtInt(kpis.respInc)} incumplidos`,
    },
    {
      label: "CSAT promedio (por año)",
      value: kpis.csatAvg == null ? "—" : kpis.csatAvg.toFixed(2),
      note: `Cobertura: ${fmtPct(kpis.csatCoverage)}`,
    },
    {
      label: "Tickets x Persona",
      value: kpis.tpp6m == null ? "—" : kpis.tpp6m.toFixed(1),
      note: `${f(kpis.tppHealth.label)}`,
      warnDot: kpis.tppHealth.label.toLowerCase().includes("límite") || kpis.tppHealth.label.toLowerCase().includes("limite"),
    },
  ] as Array<{ label: string; value: string; note: string; warnDot?: boolean }>;

  const css = `
  @page { size: A4; margin: 14mm; }
  html, body { height: 100%; }
  body {
    margin: 0;
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
    background: ${bg};
    color: ${textDark};
  }
  .container { max-width: 980px; margin: 0 auto; }
  .titleWrap { text-align:center; padding: 4mm 0 2mm; }
  .h1 { font-size: 18px; font-weight: 800; margin: 0; }
  .sub { font-size: 9.5px; color: ${textMuted}; margin-top: 4px; }
  .meta { font-size: 9px; color: ${textMuted}; margin: 4px 0 10px; }
  .row { display: grid; gap: 10px; }
  .row.filters { grid-template-columns: repeat(4, 1fr); margin: 8px 0 12px; }
  .row.kpis { grid-template-columns: repeat(5, 1fr); margin: 8px 0 12px; }
  .row.two { grid-template-columns: 1.3fr 1fr; margin: 10px 0; }
  .row.twoEq { grid-template-columns: 1fr 1fr; margin: 10px 0; }

  .card {
    background: #fff;
    border: 1px solid ${cardBorder};
    border-radius: 12px;
    padding: 10px 12px;
  }
  .cardTitle { font-size: 10px; font-weight: 700; color: ${textMuted}; margin: 0 0 4px; }
  .big { font-size: 18px; font-weight: 800; margin: 0; }
  .note { font-size: 9px; color: ${textMuted}; margin-top: 2px; line-height: 1.2; }
  .dot { display:inline-block; width: 6px; height: 6px; border-radius: 999px; background: ${warn}; margin-right: 6px; vertical-align: middle; }

  /* Tables */
  table { width: 100%; border-collapse: collapse; font-size: 8.8px; }
  th, td { border: 1px solid ${cardBorder}; padding: 5px 6px; }
  th { background: #f8fafc; color: #334155; font-weight: 800; text-align: left; }
  td { color: ${textDark}; }
  .tight th, .tight td { padding: 4px 5px; font-size: 8.3px; }

  /* Heatmap hour blocks */
  .hourGrid { display:grid; grid-template-columns: repeat(6, 1fr); gap: 6px; }
  .hourCell {
    border: 1px solid ${cardBorder};
    border-radius: 10px;
    padding: 6px;
    text-align: center;
  }
  .hourCell .h { font-size: 8px; font-weight: 700; }
  .hourCell .v { font-size: 10px; font-weight: 800; margin-top: 2px; }

  .sectionTitle { font-size: 11px; font-weight: 800; margin: 0 0 6px; }
  .footer { font-size: 8.5px; color: ${textMuted}; margin-top: 8px; }

  /* Page break control to avoid cut charts */
  .avoidBreak { break-inside: avoid; page-break-inside: avoid; }
  .pageBreak { break-before: page; page-break-before: always; height: 0; }
  `;

  const rgbaHeat = (count: number, max: number) => {
    if (!count || !max) return { bg: "#ffffff", color: textDark };
    const ratio = Math.max(0, Math.min(1, count / max));
    const alpha = 0.06 + ratio * 0.82;
    // blue rgb for #2563eb
    const bgc = `rgba(37, 99, 235, ${alpha.toFixed(3)})`;
    const tc = alpha > 0.55 ? "#ffffff" : textDark;
    return { bg: bgc, color: tc };
  };

  // --- Build tables/blocks ---
  const simpleTable = (headers: string[], rows: Array<Array<any>>, cls?: string) => {
    const th = headers.map((h) => `<th>${f(h)}</th>`).join("");
    const tr = rows
      .map((r) => `<tr>${r.map((c) => `<td>${f(c)}</td>`).join("")}</tr>`)
      .join("");
    return `<table class="${cls || ""}"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
  };

  
  // --- Mini charts (SVG) to preserve dashboard look in PDF ---
  const svgEsc = (s: any) => escapeHtml(s);

  const svgLineChart = (points: Array<{ label: string; value: number }>, opts?: { w?: number; h?: number }) => {
    const w = opts?.w ?? 520;
    const h = opts?.h ?? 160;
    const padL = 34, padR = 10, padT = 12, padB = 28;
    const iw = w - padL - padR;
    const ih = h - padT - padB;
    const vals = points.map(p => Number(p.value) || 0);
    const minV = Math.min(...vals, 0);
    const maxV = Math.max(...vals, 1);
    const yScale = (v: number) => padT + (maxV === minV ? ih/2 : (maxV - v) * ih / (maxV - minV));
    const xScale = (i: number) => padL + (points.length <= 1 ? 0 : i * iw / (points.length - 1));

    // grid lines (4)
    const gridLines = Array.from({length: 4}).map((_,k) => {
      const y = padT + (k * ih/3);
      return `<line x1="${padL}" y1="${y.toFixed(2)}" x2="${(w-padR).toFixed(2)}" y2="${y.toFixed(2)}" stroke="${grid}" stroke-width="1" />`;
    }).join("");

    // y labels (match grid lines)
    const yLabels = Array.from({length: 4}).map((_,k) => {
      const v = maxV - (k * (maxV - minV) / 3);
      const y = padT + (k * ih/3);
      return `<text x="${(padL-8).toFixed(2)}" y="${(y+3).toFixed(2)}" font-size="9" fill="${textMuted}" text-anchor="end">${svgEsc(fmtShort(v))}</text>`;
    }).join("");

    const axes = `
      <line x1="${padL}" y1="${(h-padB).toFixed(2)}" x2="${(w-padR).toFixed(2)}" y2="${(h-padB).toFixed(2)}" stroke="${grid}" stroke-width="1"/>
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${(h-padB).toFixed(2)}" stroke="${grid}" stroke-width="1"/>
    `;

    // path
    const d = points.map((p,i) => {
      const x = xScale(i), y = yScale(Number(p.value)||0);
      return `${i===0 ? "M":"L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    }).join(" ");
    const dots = points.map((p,i) => {
      const x = xScale(i), y = yScale(Number(p.value)||0);
      return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="2.8" fill="${blue}" />`;
    }).join("");

    // x labels: show ~6 labels max
    const step = Math.max(1, Math.ceil(points.length / 6));
    const xLabels = points.map((p,i) => {
      if (i % step !== 0 && i !== points.length-1) return "";
      const x = xScale(i);
      return `<text x="${x.toFixed(2)}" y="${(h-10).toFixed(2)}" font-size="9" fill="${textMuted}" text-anchor="middle">${svgEsc(p.label)}</text>`;
    }).join("");

    return `
      <svg width="100%" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="line chart">
        <rect x="0" y="0" width="${w}" height="${h}" fill="#ffffff" rx="10" ry="10"/>
        ${gridLines}
        ${axes}
        ${yLabels}
        <path d="${d}" fill="none" stroke="${blue}" stroke-width="2.2" />
        ${dots}
        ${xLabels}
      </svg>
    `;
  };

  const svgBarsH = (
    rows: Array<{ label: string; value: number }>,
    opts?: { w?: number; h?: number }
  ) => {
    const w = opts?.w ?? 440;
    const h = opts?.h ?? 190;

    const maxLabelLen = Math.max(...rows.map((r) => String(r.label || "").length), 0);

    // Más espacio para nombres (centrar el área del gráfico hacia el centro)
    const padL = Math.min(160, Math.max(90, 6 * maxLabelLen + 18));
    const padR = 56;
    const padT = 12;
    const padB = 16;

    const iw = w - padL - padR;
    const ih = h - padT - padB;

    const maxV = Math.max(...rows.map((r) => Number(r.value) || 0), 1);
    const barH = ih / Math.max(rows.length, 1);
    const gap = Math.min(10, barH * 0.28);

    const labelFont = maxLabelLen > 20 ? 8 : 9;

    const bars = rows
      .map((r, i) => {
        const y = padT + i * barH + gap / 2;
        const bh = barH - gap;
        const v = Number(r.value) || 0;
        const bw = iw * v / maxV;

        // Valor alineado a la derecha dentro del área del gráfico para que no quede "pegado" al borde
        const valueX = w - 14;

        return `
        <text x="${(padL - 10).toFixed(2)}" y="${(y + bh * 0.72).toFixed(2)}" font-size="${labelFont}" fill="${textDark}" text-anchor="end">${svgEsc(r.label)}</text>
        <rect x="${padL}" y="${y.toFixed(2)}" width="${bw.toFixed(2)}" height="${bh.toFixed(2)}" rx="7" fill="${blue}" />
        <text x="${valueX}" y="${(y + bh * 0.72).toFixed(2)}" font-size="9" fill="${textMuted}" text-anchor="end">${svgEsc(fmtInt(v))}</text>
      `;
      })
      .join("");

    return `
      <svg width="100%" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="horizontal bars">
        <rect x="0" y="0" width="${w}" height="${h}" fill="#ffffff" rx="10" ry="10"/>
        ${bars}
      </svg>
    `;
  };

  const svgStackedBars = (rows: Array<{ label: string; okPct: number; badPct: number }>, opts?: { w?: number; h?: number }) => {
    const w = opts?.w ?? 440;
    const h = opts?.h ?? 160;
    const padL = 26, padR = 14, padT = 14, padB = 28;
    const iw = w - padL - padR;
    const ih = h - padT - padB;
    const barW = iw / Math.max(rows.length, 1);
    const gap = Math.min(12, barW*0.25);

    const bars = rows.map((r,i) => {
      const x = padL + i*barW + gap/2;
      const bw = barW - gap;
      const okH = ih * (Math.max(0, Math.min(100, r.okPct)) / 100);
      const badH = ih * (Math.max(0, Math.min(100, r.badPct)) / 100);
      const yOk = padT + (ih - okH);
      const yBad = yOk - badH;
      const yTop = yBad;
      const okLabel = `${(Math.max(0, Math.min(100, r.okPct))).toFixed(2)}%`;
      return `
        <rect x="${x.toFixed(2)}" y="${yOk.toFixed(2)}" width="${bw.toFixed(2)}" height="${okH.toFixed(2)}" fill="${blue}" />
        <rect x="${x.toFixed(2)}" y="${yBad.toFixed(2)}" width="${bw.toFixed(2)}" height="${badH.toFixed(2)}" fill="${warn}" />
        <text x="${(x+bw/2).toFixed(2)}" y="${Math.max(padT+10, yTop-8).toFixed(2)}" font-size="10" fill="${textDark}" font-weight="800" text-anchor="middle">${svgEsc(okLabel)}</text>
        <text x="${(x+bw/2).toFixed(2)}" y="${(h-10).toFixed(2)}" font-size="9" fill="${textMuted}" text-anchor="middle">${svgEsc(r.label)}</text>
      `;
    }).join("");

    return `
      <svg width="100%" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="stacked bars">
        <rect x="0" y="0" width="${w}" height="${h}" fill="#ffffff" rx="10" ry="10"/>
        ${bars}
</svg>
    `;
  };

  const svgBars = (rows: Array<{ label: string; value: number }>, opts?: { w?: number; h?: number; yMax?: number }) => {
    const w = opts?.w ?? 440;
    const h = opts?.h ?? 160;
    const padL = 26, padR = 14, padT = 14, padB = 28;
    const iw = w - padL - padR;
    const ih = h - padT - padB;
    const maxV = opts?.yMax ?? Math.max(...rows.map(r => Number(r.value)||0), 1);
    const barW = iw / Math.max(rows.length, 1);
    const gap = Math.min(14, barW*0.28);

    const bars = rows.map((r,i) => {
      const x = padL + i*barW + gap/2;
      const bw = barW - gap;
      const v = Number(r.value)||0;
      const bh = ih * v / maxV;
      const y = padT + (ih - bh);
      const valueLabel = (Math.round(v*100)/100).toFixed(2).replace(/\.00$/, "");
      return `
        <rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${bw.toFixed(2)}" height="${bh.toFixed(2)}" fill="${blue}" />
        <text x="${(x+bw/2).toFixed(2)}" y="${Math.max(padT+10, y-8).toFixed(2)}" font-size="10" fill="${textDark}" font-weight="800" text-anchor="middle">${svgEsc(valueLabel)}</text>
        <text x="${(x+bw/2).toFixed(2)}" y="${(h-10).toFixed(2)}" font-size="9" fill="${textMuted}" text-anchor="middle">${svgEsc(r.label)}</text>
      `;
    }).join("");

    // grid lines (3)
    const gridLines = Array.from({length: 3}).map((_,k) => {
      const y = padT + (k * ih/2);
      return `<line x1="${padL}" y1="${y.toFixed(2)}" x2="${(w-padR).toFixed(2)}" y2="${y.toFixed(2)}" stroke="${grid}" stroke-width="1" />`;
    }).join("");

    return `
      <svg width="100%" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="bar chart">
        <rect x="0" y="0" width="${w}" height="${h}" fill="#ffffff" rx="10" ry="10"/>
        ${gridLines}
        ${bars}
      </svg>
    `;
  };

const svgDonut = (
  rows: Array<{ label: string; value: number }>,
  opts?: { w?: number; h?: number }
) => {
  const w = opts?.w ?? 420;
  const h = opts?.h ?? 165;
  const cx = 120;
  const cy = 82;
  const rOuter = 58;
  const rInner = 32;

  const palette = ["#2563eb", "#60a5fa", "#1d4ed8", "#93c5fd", "#3b82f6", "#94a3b8"];

  const vals = rows.map((r) => Math.max(0, Number(r.value) || 0));
  const total = vals.reduce((s, v) => s + v, 0) || 1;

  const arc = (r: number, a0: number, a1: number) => {
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    return { x0, y0, x1, y1 };
  };

  let ang = -Math.PI / 2;
  const paths = rows
    .map((r, i) => {
      const v = Math.max(0, Number(r.value) || 0);
      const frac = v / total;
      const a0 = ang;
      const a1 = ang + frac * Math.PI * 2;
      ang = a1;

      const large = a1 - a0 > Math.PI ? 1 : 0;

      const o = arc(rOuter, a0, a1);
      const ii = arc(rInner, a1, a0); // note reversed

      const d = [
        `M ${o.x0.toFixed(2)} ${o.y0.toFixed(2)}`,
        `A ${rOuter} ${rOuter} 0 ${large} 1 ${o.x1.toFixed(2)} ${o.y1.toFixed(2)}`,
        `L ${ii.x0.toFixed(2)} ${ii.y0.toFixed(2)}`,
        `A ${rInner} ${rInner} 0 ${large} 0 ${ii.x1.toFixed(2)} ${ii.y1.toFixed(2)}`,
        "Z",
      ].join(" ");

      const color = palette[i % palette.length];
      return `<path d="${d}" fill="${color}"></path>`;
    })
    .join("");

  // Legend (right side)
  const legend = rows
    .map((r, i) => {
      const color = palette[i % palette.length];
      const y = 28 + i * 18;
      const pctVal = total ? ((Number(r.value) || 0) / total) * 100 : 0;
      const label = String(r.label || "").length > 18 ? String(r.label).slice(0, 18) + "…" : String(r.label);
      return `
        <rect x="210" y="${y}" width="10" height="10" rx="2" fill="${color}"></rect>
        <text x="226" y="${y + 9}" font-size="9" fill="${textDark}">${svgEsc(label)}</text>
        <text x="${w - 10}" y="${y + 9}" font-size="9" fill="${textMuted}" text-anchor="end">${svgEsc(fmtInt(r.value))} (${pctVal.toFixed(1)}%)</text>
      `;
    })
    .join("");

  return `
    <svg width="100%" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="donut chart">
      <rect x="0" y="0" width="${w}" height="${h}" fill="#ffffff" rx="10" ry="10"/>
      ${paths}
      ${legend}
    </svg>
  `;
};


  // Data for charts
  const ticketsByMonthPts = series.ticketsByMonth.map((x) => ({ label: monthLabel(x.month), value: Number(x.tickets) || 0 }));
  const ticketsByMonthSvg = svgLineChart(ticketsByMonthPts, { w: 520, h: 165 });

  const ticketsByYearBars = series.ticketsByYear.map((x) => ({ label: x.year, value: Number(x.tickets) || 0 }));
  const ticketsByYearSvg = svgBarsH(ticketsByYearBars, { w: 380, h: 165 });

  const slaRows = series.slaByYear.map((x) => ({ label: x.year, okPct: Number(x.CumplidoPct) || 0, badPct: Number(x.IncumplidoPct) || 0 }));
  const slaByYearSvg = svgStackedBars(slaRows, { w: 440, h: 165 });

  const csatRows = series.csatByYear.map((x) => ({ label: x.year, value: x.csatAvg == null ? 0 : Number(x.csatAvg) || 0 }));
  const csatByYearSvg = svgBars(csatRows, { w: 440, h: 165, yMax: 8 });

  // Optional: keep crisp tables as appendix / fallback
  const ticketsByMonthTable = simpleTable(
    ["Mes", "Tickets"],
    series.ticketsByMonth.map((x) => [monthLabel(x.month), fmtInt(x.tickets)]),
    "tight"
  );

  const ticketsByYearTable = simpleTable(
    ["Año", "Tickets"],
    series.ticketsByYear.map((x) => [x.year, fmtInt(x.tickets)]),
    "tight"
  );


// Top charts in PDF: keep them as graphics (no raw tables)
const topAssigneesSvg = svgBarsH(
  (series.topAssignees || []).map((x) => ({
    label: String(x.name || "(Vacío)").length > 28 ? String(x.name).slice(0, 28) + "…" : String(x.name || "(Vacío)"),
    value: Number(x.tickets) || 0,
  })),
  { w: 440, h: 190 }
);

const topOrgsSvg = svgDonut(
  (series.topOrgsPie || []).map((x) => ({
    label: String(x.name || "(Vacío)"),
    value: Number(x.tickets) || 0,
  })),
  { w: 440, h: 190 }
);
  const hourBlocks = (() => {
    const max = series.hourHeatMap.max || 0;
    return `<div class="hourGrid">
      ${series.hourHeatMap.data
        .map((x) => {
          const st = rgbaHeat(x.tickets, max);
          return `<div class="hourCell" style="background:${st.bg};color:${st.color}">
            <div class="h">${String(x.hour).padStart(2, "0")}:00</div>
            <div class="v">${x.tickets ? f(fmtInt(x.tickets)) : ""}</div>
          </div>`;
        })
        .join("")}
    </div>`;
  })();

    // Week heatmap table with colored cells
  const weekHeat = (() => {
    const days = series.weekHeatMap.days || [];
    const max = series.weekHeatMap.max || 0;

    const head = ["Hora", ...days].map((h) => `<th>${f(h)}</th>`).join("");
    const body = (series.weekHeatMap.matrix || [])
      .map((row: any) => {
        const cells = days
          .map((d: string) => {
            const v = Number(row[d] || 0);
            const st = rgbaHeat(v, max);
            return `<td style="background:${st.bg};color:${st.color};text-align:center;">${
              v ? f(fmtInt(v)) : ""
            }</td>`;
          })
          .join("");
        return `<tr><td style="font-weight:700;color:#334155;">${f(
          `${String(row.hour).padStart(2, "0")}:00`
        )}</td>${cells}</tr>`;
      })
      .join("");

    return `<table class="tight"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  })();

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${f(title)}</title>
    <style>${css}</style>
  </head>
  <body>
    <div class="container">
      <div class="titleWrap">
        <div class="h1">${f(title.replace("Dashboard","Report"))}</div>
        
      </div>

      <div class="meta">
        <div><b>Generado:</b> ${f(genStr)}</div>
        <div style="margin-top:4px;">${filterLine}</div>
      </div>

      <!-- KPIs -->
      <div class="row kpis avoidBreak">
        ${kpiItems
          .map(
            (k) => `<div class="card">
              <div class="cardTitle">${f(k.label)}</div>
              <div class="big">${f(k.value)}</div>
              <div class="note">${k.warnDot ? `<span class="dot"></span>` : ""}${f(k.note)}</div>${k.footnote ? `<div class="foot">${f(k.footnote)}</div>` : ""}
            </div>`
          )
          .join("")}
      </div>

      <!-- Charts (SVG) to match dashboard look; tables kept as appendix) -->
      <div class="row two avoidBreak">
        <div class="card avoidBreak">
          <div class="sectionTitle">Tickets por Mes</div>
          <div>${ticketsByMonthSvg}</div>
        </div>
        <div class="card avoidBreak">
          <div class="sectionTitle">Tickets por Año</div>
          <div>${ticketsByYearSvg}</div>
        </div>
      </div>

      <div class="row twoEq avoidBreak">
        <div class="card avoidBreak">
          <div class="sectionTitle">SLA Respuesta por Año</div>
          <div>${slaByYearSvg}</div>
        </div>
        <div class="card avoidBreak">
          <div class="sectionTitle">CSAT promedio por Año</div>
          <div>${csatByYearSvg}</div>
        </div>
      </div>

      <div class="row twoEq avoidBreak">
        <div class="card avoidBreak">
          <div class="sectionTitle">Top 5 Organizaciones + Otros</div>
          <div>${topOrgsSvg}</div>
        </div>
        <div class="card avoidBreak">
          <div class="sectionTitle">Top 10 Asignados</div>
          <div>${topAssigneesSvg}</div>
        </div>
      </div>      <div class="pageBreak"></div>

      <div class="card avoidBreak" style="margin-top:10px;">
        <div class="sectionTitle">Heatmap Horario (por hora)</div>
        ${hourBlocks}
      </div>

      <div class="pageBreak"></div>

      <div class="card avoidBreak" style="margin-top:10px;">
        <div class="sectionTitle">Heatmap Semana (día vs hora)</div>
        ${weekHeat}
      </div>

      <div class="footer">
        Sugerencia: aplica enfoque Pareto 80/20 sobre Top Organizaciones/Asignados para reducir demanda recurrente.
      </div>
    </div>
  </body>
</html>`;
}

function kpiCard(
  title: string,
  value: any,
  subtitle?: string,
  right?: string,
  badge?: React.ReactNode,
  extra?: React.ReactNode
) {
  return (
    <Card className={UI.card}>
      <CardHeader className="pb-2">
        <CardTitle className={UI.title}>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-2xl font-semibold tracking-tight text-slate-900">
              {value}
            </div>
            {badge ? <div className="mt-2">{badge}</div> : null}
            {subtitle ? <div className={"mt-1 " + UI.subtle}>{subtitle}</div> : null}
          </div>
          {right ? <div className={"text-right " + UI.subtle}>{right}</div> : null}
        </div>
        {extra ? <div className="mt-3">{extra}</div> : null}
      </CardContent>
    </Card>
  );
}

function HealthBadge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{ backgroundColor: "#f1f5f9", color }}
    >
      {label}
    </span>
  );
}


function addMonths(ymStr: string, delta: number) {
  const [yS, mS] = ymStr.split("-");
  const y = Number(yS);
  const m = Number(mS);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return ymStr;
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() + delta);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}`;
}

function monthsBetween(fromYm: string, toYm: string) {
  const out: string[] = [];
  if (!fromYm || !toYm) return out;
  let cur = fromYm;
  for (let i = 0; i < 240; i++) {
    out.push(cur);
    if (cur === toYm) break;
    cur = addMonths(cur, 1);
  }
  return out;
}

function fmtPeriod(months: string[]) {
  if (!months.length) return "";
  const start = months[0];
  const end = months[months.length - 1];
  const startLbl = monthLabel(start);
  const endLbl = monthLabel(end);
  return start === end ? startLbl : `${startLbl} – ${endLbl}`;
}

function deltaStyle(isGood: boolean) {
  return isGood ? { color: UI.ok } : { color: UI.danger };
}

function DeltaLine({
  label,
  basePeriod,
  pct,
  abs,
  isGood,
}: {
  label: string;
  basePeriod: string;
  pct: number;
  abs?: number | null;
  isGood: boolean;
}) {
  const arrow = pct === 0 ? "•" : pct > 0 ? "▲" : "▼";
  const pctTxt = `${Math.abs(pct).toFixed(1)}%`;
  const absTxt = abs == null ? "" : ` (${abs > 0 ? "+" : ""}${abs.toFixed(2)})`;
  return (
    <div className={"text-xs " + UI.subtle}>
      <span style={deltaStyle(isGood)} className="font-semibold">
        {arrow} {pctTxt}{absTxt}
      </span>{" "}
      {label} vs {basePeriod}
    </div>
  );
}

function YearBars({
  rows,
  maxTickets,
}: {
  rows: Array<{ year: string; tickets: number; partialLabel: string }>;
  maxTickets: number;
}) {
  return (
    <div className="space-y-3">
      {rows.map((r) => {
        const pctW = maxTickets
          ? Math.max(0, Math.min(100, (r.tickets / maxTickets) * 100))
          : 0;
        return (
          <div key={r.year} className="flex items-center gap-3">
            <div className="w-12 text-sm text-slate-700 font-semibold">{r.year}</div>
            <div className="flex-1">
              <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-3 rounded-full"
                  style={{ width: `${pctW}%`, backgroundColor: UI.primary }}
                />
              </div>
            </div>
            <div className="w-40 text-right text-sm text-slate-700">
              <span className="font-semibold">{formatInt(r.tickets)}</span>
              <span className="text-xs text-slate-500">{r.partialLabel}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Mini-tests (dev) para mantener consistente el parsing
let __testsRan = false;
function runParserTestsOnce() {
  if (__testsRan) return;
  __testsRan = true;

  console.assert(
    parseCreated("19/ene/26 12:47 PM") instanceof Date,
    "parseCreated should parse Spanish months"
  );
  console.assert(ym(new Date(2026, 0, 19)) === "2026-01", "ym should format YYYY-MM");

  console.assert(parseSlaHours("") === null, "blank SLA should be null");
  console.assert(parseSlaHours(null) === null, "null SLA should be null");
  console.assert(parseSlaHours("0:00") === 0, "0:00 SLA should be 0");
  console.assert(parseSlaHours("00:00") === 0, "00:00 SLA should be 0");
  console.assert((parseSlaHours("1:30") || 0) > 0, "positive SLA should be > 0");
  console.assert((parseSlaHours("-1:30") || 0) < 0, "negative SLA should be < 0");

  const arr: string[] = [];
  const min = arr.length ? arr[0] : undefined;
  console.assert(min === undefined, "safe min when empty");
}

type Row = {
  key: string;
  organization: string;
  estado: string;
  asignado: string;
  creada: Date;
  year: number;
  month: string;
  slaResponseHours: number | null;
  slaResponseStatus: "Cumplido" | "Incumplido";
  satisfaction: number | null;
};

type StoredRow = Omit<Row, "creada"> & { creada: string };

function serializeRows(rows: Row[]): StoredRow[] {
  return rows.map((row) => ({ ...row, creada: row.creada.toISOString() }));
}

function hydrateRows(rows: StoredRow[]): Row[] {
  return rows
    .map((row) => ({ ...row, creada: new Date(row.creada) }))
    .filter((row) => !Number.isNaN(row.creada.getTime()));
}

export default function JiraExecutiveDashboard() {
  if (typeof window !== "undefined") runParserTestsOnce();

  const { settings, setSettings } = useSettings();
  const coverageShifts = useMemo(() => getCoverageShifts(settings), [settings]);
  const coverageKinds = useMemo(() => {
    let hasNormal = false;
    let hasGuardia = false;
    for (const sh of coverageShifts) {
      if (sh.enabled === false) continue;
      if (sh.kind === "guardia") hasGuardia = true;
      else hasNormal = true;
    }
    return { hasNormal, hasGuardia, split: hasNormal && hasGuardia };
  }, [coverageShifts]);

  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Filters: rango por mes (YYYY-MM)
  const [fromMonth, setFromMonth] = useState<string>("all");
  const [toMonth, setToMonth] = useState<string>("all");

  const [autoRange, setAutoRange] = useState<{ minMonth: string | null; maxMonth: string | null }>({
    minMonth: null,
    maxMonth: null,
  });

  const [orgFilter, setOrgFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(DASHBOARD_ROWS_LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as StoredRow[];
      if (!Array.isArray(parsed) || parsed.length === 0) return;
      const hydrated = hydrateRows(parsed);
      if (!hydrated.length) return;
      hydrated.sort((a, b) => a.creada.getTime() - b.creada.getTime());
      setRows(hydrated);
      const minMonth = hydrated[0].month;
      const maxMonth = hydrated[hydrated.length - 1].month;
      setAutoRange({ minMonth, maxMonth });
      setFromMonth(minMonth);
      setToMonth(maxMonth);
    } catch {
      // ignore
    }
  }, []);

  const onFile = (file: File) => {
    setError(null);

    Papa.parse(file, {
      transformHeader: (h) => String(h || "").trim().toLowerCase(),
      header: true,
      skipEmptyLines: true,
      complete: (res: any) => {
        try {
          const data = (res.data || []).filter(Boolean);
          const parsed: Row[] = [];
          let badDate = 0;

          for (const r of data) {
            const creadaRaw = String(coalesce(r["creada"], "")).trim();
            const creada = parseCreated(creadaRaw);
            if (!creada) {
              badDate += 1;
              continue;
            }

            const slaRespRaw = getField(r, [
              "campo personalizado (time to first response)",
              "campo personalizado (time to first response).",
              "custom field (time to first response)",
              "custom field (time to first response).",
              "time to first response",
              "time to first response (hrs)",
              "sla response",
              "sla de response",
            ]);
            const slaResp = parseSlaHours(slaRespRaw);
            const respStatus: Row["slaResponseStatus"] =
              slaResp != null && slaResp < 0 ? "Incumplido" : "Cumplido";

            const satRaw = getField(r, [
              "calificación de satisfacción",
              "calificacion de satisfaccion",
              "satisfaction",
            ]);
            const satStr = satRaw == null ? "" : String(satRaw).trim();
            const satVal = satStr === "" ? null : Number(satStr);
            const sat = Number.isFinite(satVal as any) ? (satVal as number) : null;

            const org = String(
              coalesce(
                getField(r, [
                  "campo personalizado (organizations)",
                  "organizations",
                  "organization",
                  "organisation",
                ]),
                ""
              )
            ).trim();

            const estado = String(coalesce(r["estado"], "")).trim();
            // Excluir Block/Hold
            if (/\b(block|hold)\b/i.test(estado)) continue;

            parsed.push({
              key: String(coalesce(r["clave de incidencia"], coalesce(r["key"], ""))).trim(),
              organization: org,
              estado,
              asignado: String(coalesce(r["persona asignada"], "")).trim(),
              creada,
              year: creada.getFullYear(),
              month: ym(creada),
              slaResponseHours: slaResp,
              slaResponseStatus: respStatus,
              satisfaction: sat,
            });
          }

          if (!parsed.length) {
            setRows([]);
            setError(
              "No pude parsear filas con fecha 'Creada'. Revisa que el CSV tenga columna 'Creada' y formato tipo 19/ene/26 12:47 PM."
            );
            return;
          }

          parsed.sort((a, b) => a.creada.getTime() - b.creada.getTime());
          setRows(parsed);
          if (typeof window !== "undefined") {
            try {
              window.localStorage.setItem(DASHBOARD_ROWS_LS_KEY, JSON.stringify(serializeRows(parsed)));
            } catch {
              // ignore
            }
          }


// ---- Roles/Dotación: guardar universo de "Asignado" en Settings y auto-inicializar roles faltantes ----
try {
  const assigneesUniverse = Array.from(
    new Set(parsed.map((x) => String(x.asignado || "").trim()).filter((x) => x))
  ).sort((a, b) => a.localeCompare(b));

  const prevRoles = ((settings as any).roles || {}) as any;
  const prevMap = (prevRoles.map || {}) as Record<string, AssigneeRole>;
  const nextMap: Record<string, AssigneeRole> = { ...prevMap };

  for (const n of assigneesUniverse) {
    if (!nextMap[n]) nextMap[n] = "Agente"; // default razonable
  }

  setSettings({
    ...(settings as any),
    roles: {
      inclusion: prevRoles.inclusion || DEFAULT_ROLE_INCLUSION,
      universe: assigneesUniverse,
      map: nextMap,
    },
  } as any);
} catch {
  // ignore
}

          const minMonth = parsed[0].month;
          const maxMonth = parsed[parsed.length - 1].month;
          setAutoRange({ minMonth, maxMonth });
          setFromMonth(minMonth);
          setToMonth(maxMonth);

          if (badDate > 0) {
            setError(`Aviso: ${badDate} filas fueron omitidas porque la fecha 'Creada' no era interpretable.`);
          }
        } catch (e: any) {
          setError((e && e.message) || "Error procesando el CSV");
          setRows([]);
        }
      },
      error: (err: any) => {
        setError(err.message);
        setRows([]);
      },
    });
  };

  const filterOptions = useMemo(() => {
    const orgs = Array.from(new Set(rows.map((r) => r.organization).filter(Boolean))).sort();
    const assignees = Array.from(new Set(rows.map((r) => r.asignado).filter(Boolean))).sort();
    const estados = Array.from(new Set(rows.map((r) => r.estado).filter(Boolean))).sort();
    const months = Array.from(new Set(rows.map((r) => r.month))).sort();
    return { orgs, assignees, estados, months };
  }, [rows]);

  const minMonthBound =
    autoRange.minMonth ?? (filterOptions.months.length ? filterOptions.months[0] : undefined);
  const maxMonthBound =
    autoRange.maxMonth ??
    (filterOptions.months.length ? filterOptions.months[filterOptions.months.length - 1] : undefined);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (fromMonth !== "all" && r.month < fromMonth) return false;
      if (toMonth !== "all" && r.month > toMonth) return false;
      if (orgFilter !== "all" && r.organization !== orgFilter) return false;
      if (assigneeFilter !== "all" && r.asignado !== assigneeFilter) return false;
      if (statusFilter !== "all" && r.estado !== statusFilter) return false;
      return true;
    });
  }, [rows, fromMonth, toMonth, orgFilter, assigneeFilter, statusFilter]);

  const kpis = useMemo(() => {
    const total = filtered.length;
    const respInc = filtered.filter((r) => r.slaResponseStatus === "Incumplido").length;

    const rated = filtered.filter((r) => r.satisfaction != null);
    const csatAvg =
      rated.length > 0
        ? rated.reduce((s, r) => s + (r.satisfaction == null ? 0 : r.satisfaction), 0) / rated.length
        : null;

    const latestMonth = total > 0 ? filtered[total - 1].month : null;
    const monthCount = latestMonth ? filtered.filter((r) => r.month === latestMonth).length : 0;


// Tickets/Persona: promedio últimos 6 meses (sin considerar mes actual si no está cerrado)
// Fórmula (dotación variable): KPI = TotalTickets(últimos 6 meses) / SUM(dotación_mes)
// Dotación_mes: conteo de personas únicas en "Asignado" que aparecen en tickets creados en ese mes (y cuyo rol cuenta).
const { inclusion: roleInclusion, map: assigneeRoleMap } = getRoleSettings(settings as any);

const monthsSorted = Array.from(new Set(filtered.map((r) => r.month))).sort();
const maxCreated = filtered.length ? filtered[filtered.length - 1].creada : null;
const currentMonth = maxCreated ? ym(maxCreated) : null;

const isClosedMonth = (d: Date | null) => {
  if (!d) return true;
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return d.getDate() === lastDay;
};

const monthsForAvg = (() => {
  if (!monthsSorted.length) return [] as string[];
  if (!maxCreated || !currentMonth) return monthsSorted;
  if (!isClosedMonth(maxCreated)) return monthsSorted.filter((m) => m !== currentMonth);
  return monthsSorted;
})();

const last6 = monthsForAvg.slice(-6);

const monthTeamSize = (m: string) => {
  const set = new Set<string>();
  for (const r of filtered) {
    if (r.month !== m) continue;
    const name = String(r.asignado || "").trim();
    if (!name) continue;
    const role = (assigneeRoleMap[name] as AssigneeRole | undefined) ?? "Agente";
    if (roleIncluded(role, roleInclusion)) set.add(name);
  }
  return set.size;
};

const totalTickets6m = last6.reduce((s, m) => s + filtered.filter((r) => r.month === m).length, 0);
const denomPeopleMonths = last6.reduce((s, m) => s + monthTeamSize(m), 0);

const tpp6m = denomPeopleMonths > 0 ? totalTickets6m / denomPeopleMonths : null;

const tppHealth = (() => {
  const tpp = (settings as any)?.tpp || {};
  const capacityMax = Number(tpp.capacityMax ?? 40);
  const optimalMax = Number(tpp.optimalMax ?? 70);
  const limitMax = Number(tpp.limitMax ?? 95);

  if (tpp6m == null) return { label: "Sin dato", color: "#94a3b8" };
  if (tpp6m < capacityMax) return { label: "Con Capacidad", color: UI.primary };
  if (tpp6m >= capacityMax && tpp6m <= optimalMax) return { label: "Óptimo", color: UI.ok };
  if (tpp6m > optimalMax && tpp6m <= limitMax) return { label: "Al Límite", color: UI.warning };
  return { label: "Warning", color: UI.danger };
})();


    return {
      total,
      latestMonth,
      monthCount,
      respInc,
      respOkPct: 100 - pct(respInc, total),
      csatAvg,
      csatCoverage: pct(rated.length, total),
      tpp6m,
      tppHealth,
    };
  }, [filtered, settings]);


  // --- Comparativas en KPIs (según Settings) ---
  const compareCfg = (settings as any)?.compare || (settings as any) || {};
  const comparePrevious = compareCfg.comparePrevious ?? true;
  const windowMonths = (compareCfg.compareWindowMonths ?? 12) as 3 | 6 | 12;

  // Base: aplicamos filtros no-temporales (org/asignado/estado) pero dejamos variar el periodo
  const nonDateFiltered = useMemo(() => {
    return rows.filter((r) => {
      if (orgFilter !== "all" && r.org !== orgFilter) return false;
      if (assigneeFilter !== "all" && r.asignado !== assigneeFilter) return false;
      if (statusFilter !== "all" && r.estado !== statusFilter) return false;
      return true;
    });
  }, [rows, orgFilter, assigneeFilter, statusFilter]);

  const compareData = useMemo(() => {
    const monthsSel = monthsBetween(fromMonth, toMonth);
    const baseMonths = monthsSel.length > windowMonths ? monthsSel.slice(-windowMonths) : monthsSel;

    const monthsSet = new Set(nonDateFiltered.map((r) => r.month));

    const periodRows = (months: string[]) => nonDateFiltered.filter((r) => months.includes(r.month));

    const calc = (months: string[]) => {
      const pr = periodRows(months);
      const total = pr.length;

      const respInc = pr.filter((r) => r.slaResponseStatus === "Incumplido").length;
      const respOkPct = total ? 100 - pct(respInc, total) : null;

      const rated = pr.filter((r) => r.satisfaction != null);
      const csatAvg = rated.length ? rated.reduce((s, r) => s + (r.satisfaction ?? 0), 0) / rated.length : null;

      // TPP con dotación variable por mes (roles)
      const { inclusion: roleInclusion, map: assigneeRoleMap } = getRoleSettings(settings as any);

      const monthTeamSize = (m: string) => {
        const set = new Set<string>();
        for (const r of pr) {
          if (r.month !== m) continue;
          const name = String(r.asignado || "").trim();
          if (!name) continue;
          const role = (assigneeRoleMap[name] as AssigneeRole | undefined) ?? "Agente";
          if (roleIncluded(role, roleInclusion)) set.add(name);
        }
        return set.size;
      };

      const denom = months.reduce((s, m) => s + monthTeamSize(m), 0);
      const tpp = denom > 0 ? total / denom : null;

      return { total, respOkPct, csatAvg, tpp };
    };

    const base = calc(baseMonths);

    const refPrev1Months =
      baseMonths.length
        ? monthsBetween(addMonths(baseMonths[0], -baseMonths.length), addMonths(baseMonths[0], -1))
        : [];

    const refPrev2Months =
      refPrev1Months.length
        ? monthsBetween(addMonths(refPrev1Months[0], -refPrev1Months.length), addMonths(refPrev1Months[0], -1))
        : [];

    const hasAllMonths = (months: string[]) => months.length > 0 && months.every((m) => monthsSet.has(m));

    // Regla: mostrar comparativas sólo si existe al menos 1 período anterior completo.
    const prev1 = comparePrevious && hasAllMonths(refPrev1Months) ? calc(refPrev1Months) : null;
    const prev2 = comparePrevious && prev1 && hasAllMonths(refPrev2Months) ? calc(refPrev2Months) : null;

    const deltaPct = (cur: number | null, ref: number | null) => {
      if (cur == null || ref == null || ref == 0) return null;
      return ((cur - ref) / Math.abs(ref)) * 100;
    };

    return {
      baseMonths,
      baseLabel: fmtPeriod(baseMonths),
      prev1Label: fmtPeriod(refPrev1Months),
      prev2Label: fmtPeriod(refPrev2Months),
      base,
      prev1,
      prev2,
      deltaPct,
    };
  }, [fromMonth, toMonth, windowMonths, comparePrevious, nonDateFiltered, settings]);

  const kpiExtras = useMemo(() => {
    const d = compareData;
    const out: Record<string, any> = {};

    const mk = (metric: keyof typeof d.base, goodWhenHigher: boolean) => {
      const baseVal: any = (d.base as any)[metric];
      const lines: any[] = [];

      const refs: Array<{ key: string; label: string; period: string; data: any }> = [];
      if (d.prev1) refs.push({ key: "p1", label: "P-1", period: d.prev1Label, data: d.prev1 });
      if (d.prev2) refs.push({ key: "p2", label: "P-2", period: d.prev2Label, data: d.prev2 });

      for (const ref of refs) {
        const refVal: any = (ref.data as any)[metric];
        const p = d.deltaPct(baseVal, refVal);
        if (p != null) {
          const isGood = goodWhenHigher ? p >= 0 : p <= 0;
          lines.push(
            <DeltaLine
              key={ref.key}
              label={ref.label}
              basePeriod={ref.period}
              pct={p}
              abs={typeof baseVal === "number" && typeof refVal === "number" ? baseVal - refVal : null}
              isGood={isGood}
            />
          );
        }
      }

      if (!lines.length) return null;
      return (
        <div className="space-y-1">
          <div className={"text-xs " + UI.subtle}>Base: {d.baseLabel}</div>
          {lines}
        </div>
      );
    };

    out.tickets = mk("total", true);
    out.sla = mk("respOkPct", true);
    out.csat = mk("csatAvg", true);
    out.tpp = mk("tpp", false);
    return out;
  }, [compareData]);

  const series = useMemo(() => {
    // Tickets por mes
    const byMonth = new Map<string, { month: string; tickets: number }>();
    for (const r of filtered) {
      const cur = byMonth.get(r.month) || { month: r.month, tickets: 0 };
      cur.tickets += 1;
      byMonth.set(r.month, cur);
    }
    const ticketsByMonth = Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month));

    // Tickets por año
    const byYear = new Map<string, { year: string; tickets: number }>();
    for (const r of filtered) {
      const y = String(r.year);
      const cur = byYear.get(y) || { year: y, tickets: 0 };
      cur.tickets += 1;
      byYear.set(y, cur);
    }
    const ticketsByYear = Array.from(byYear.values()).sort((a, b) => Number(a.year) - Number(b.year));

    // Estado por año
    const yearStatus = new Map<string, any>();
    for (const r of filtered) {
      const y = String(r.year);
      const obj = yearStatus.get(y) || { year: y };
      const s = r.estado || "(Sin estado)";
      obj[s] = (obj[s] || 0) + 1;
      yearStatus.set(y, obj);
    }
    const estadoByYear = Array.from(yearStatus.values()).sort((a, b) => Number(a.year) - Number(b.year));

    // SLA response por año
    const slaYear = new Map<string, any>();
    for (const r of filtered) {
      const y = String(r.year);
      const obj =
        slaYear.get(y) ||
        ({ year: y, Total: 0, Cumplido: 0, Incumplido: 0, CumplidoPct: 0, IncumplidoPct: 0 } as any);
      obj.Total += 1;
      if (r.slaResponseStatus === "Incumplido") obj.Incumplido += 1;
      else obj.Cumplido += 1;
      slaYear.set(y, obj);
    }
    const slaByYear = Array.from(slaYear.values())
      .map((x) => ({
        ...x,
        CumplidoPct: x.Total ? (x.Cumplido / x.Total) * 100 : 0,
        IncumplidoPct: x.Total ? (x.Incumplido / x.Total) * 100 : 0,
      }))
      .sort((a, b) => Number(a.year) - Number(b.year));

    // Count helper
    const count = (keyFn: (r: Row) => string) => {
      const m = new Map<string, number>();
      for (const r of filtered) {
        const k = (keyFn(r) || "(Vacío)").trim();
        m.set(k, (m.get(k) || 0) + 1);
      }
      return Array.from(m.entries())
        .map(([k, v]) => ({ name: k, tickets: v }))
        .sort((a, b) => b.tickets - a.tickets);
    };

    const totalTickets = filtered.length;
    const topAssignees = count((r) => r.asignado).slice(0, 10);

    // Pie top 5 orgs + otros
    const allOrgs = count((r) => r.organization);
    const top5 = allOrgs.slice(0, 5);
    const top5Sum = top5.reduce((s, x) => s + x.tickets, 0);
    const others = Math.max(0, totalTickets - top5Sum);
    const topOrgsPie = [...top5];
    if (others > 0) topOrgsPie.push({ name: "Otros", tickets: others });

    // CSAT por año
    const csatByYearMap = new Map<string, { year: string; sum: number; cnt: number }>();
    for (const r of filtered) {
      if (r.satisfaction == null) continue;
      const y = String(r.year);
      const cur = csatByYearMap.get(y) || { year: y, sum: 0, cnt: 0 };
      cur.sum += Number(r.satisfaction) || 0;
      cur.cnt += 1;
      csatByYearMap.set(y, cur);
    }
    const csatByYear = Array.from(csatByYearMap.values())
      .map((x) => ({ year: x.year, csatAvg: x.cnt ? x.sum / x.cnt : null, responses: x.cnt }))
      .sort((a, b) => Number(a.year) - Number(b.year));

    // Heatmap mes vs estado (solo últimos 6 meses)
    const heatMap = (() => {
      const states = Array.from(new Set(filtered.map((r) => r.estado || "(Sin estado)"))).sort();
      const byM = new Map<string, any>();
      for (const r of filtered) {
        const key = r.month;
        const obj = byM.get(key) || { month: key };
        const s = r.estado || "(Sin estado)";
        obj[s] = (obj[s] || 0) + 1;
        byM.set(key, obj);
      }
      const allRows = Array.from(byM.values()).sort((a, b) => a.month.localeCompare(b.month));
      const rows = allRows.slice(-6);
      const range = rows.length ? `${rows[0].month} → ${rows[rows.length - 1].month}` : "—";
      return { states, rows, range };
    })();

    // Heatmap por hora
    const hourHeatMap = (() => {
      const hours = Array.from({ length: 24 }, (_, i) => i);
      const counts = new Map<number, number>();
      for (const r of filtered) {
        const h = r.creada instanceof Date ? r.creada.getHours() : null;
        if (h == null) continue;
        counts.set(h, (counts.get(h) || 0) + 1);
      }
      const data = hours.map((h) => ({ hour: h, tickets: counts.get(h) || 0 }));
      const max = data.reduce((m, x) => Math.max(m, x.tickets || 0), 0);
      return { data, max };
    })();

    // Heatmap semana (día vs hora)
    const weekHeatMap = (() => {
      const days = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]; // ISO
      const hours = Array.from({ length: 24 }, (_, i) => i);
      const matrix = hours.map((h) => ({
        hour: h,
        ...Object.fromEntries(days.map((d) => [d, 0])),
      })) as Array<Record<string, any>>;

      const isoDayIndex = (jsDay: number) => (jsDay + 6) % 7;

      for (const r of filtered) {
        if (!(r.creada instanceof Date)) continue;
        const h = r.creada.getHours();
        const di = isoDayIndex(r.creada.getDay());
        const dLabel = days[di];
        matrix[h][dLabel] = (matrix[h][dLabel] || 0) + 1;
      }

      let max = 0;
      for (const row of matrix) for (const d of days) max = Math.max(max, row[d] || 0);

      return { days, matrix, max };
    })();

    return {
      ticketsByMonth,
      ticketsByYear,
      estadoByYear,
      slaByYear,
      csatByYear,
      topAssignees,
      topOrgsPie,
      heatMap,
      hourHeatMap,
      weekHeatMap,
    };
  }, [filtered]);

  const estadoKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const obj of series.estadoByYear) {
      Object.keys(obj).forEach((k) => {
        if (k !== "year") keys.add(k);
      });
    }
    return Array.from(keys).sort();
  }, [series.estadoByYear]);

  const pieTooltipFormatter = useMemo(
    () => pieTooltipFormatterFactory(series.topOrgsPie),
    [series.topOrgsPie]
  );

  const ticketsByYearBars = useMemo(() => {
    const items = series.ticketsByYear || [];
    const maxTickets = items.reduce((m, x) => Math.max(m, Number(x.tickets) || 0), 0);

    const maxCreated = filtered.length ? filtered[filtered.length - 1].creada : null;
    const maxYear = maxCreated ? maxCreated.getFullYear() : null;
    const isPartialYear = !!maxCreated && !(maxCreated.getMonth() === 11 && maxCreated.getDate() === 31);

    return {
      maxTickets,
      rows: items.map((x) => {
        const y = Number(x.year);
        const partial = maxYear != null && y === maxYear && isPartialYear;
        return {
          year: String(x.year),
          tickets: Number(x.tickets) || 0,
          partialLabel: partial && maxCreated ? ` (parcial al ${formatDateCLShort(maxCreated)})` : "",
        };
      }),
    };
  }, [series.ticketsByYear, filtered]);

  const heatMaxMonthState = useMemo(() => {
    let max = 0;
    for (const r of series.heatMap.rows) {
      for (const s of series.heatMap.states) max = Math.max(max, Number(r[s] || 0));
    }
    return max;
  }, [series.heatMap]);

  const clearAll = () => {
    setRows([]);
    setError(null);
    setFromMonth("all");
    setToMonth("all");
    setOrgFilter("all");
    setAssigneeFilter("all");
    setStatusFilter("all");
    setAutoRange({ minMonth: null, maxMonth: null });
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(DASHBOARD_ROWS_LS_KEY);
      } catch {
        // ignore
      }
    }
  };

  const isEmpty = rows.length === 0;

  return (
    <div className={`min-h-screen ${UI.pageBg} p-4 md:p-8`}>
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
              Janis Commerce -  Care Executive Dashboard
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Sube tu CSV y verás KPIs y gráficos. Regla SLA Response (Time to first response): &gt;= 0 (o vacío) =
              cumplido; &lt; 0 = incumplido. Dotación: derivada del CSV (Asignado presente por mes) y configurable por roles en Settings.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files && e.target.files[0];
                if (f) onFile(f);
              }}
            />

            <Button
              className="text-white"
              style={{ backgroundColor: UI.primary }}
              disabled={exporting || !filtered.length}
              onClick={async () => {
                setExporting(true);
                setError(null);

                try {
                  if (!filtered.length) {
                    setError("No hay datos filtrados para exportar.");
                    return;
                  }

                  setError("Generando PDF…");

                  const now = new Date();
                  const y = now.getFullYear();
                  const m = String(now.getMonth() + 1).padStart(2, "0");
                  const d = String(now.getDate()).padStart(2, "0");
                  const filename = `Informe_Ejecutivo_Janis_Care_${y}${m}${d}.pdf`;

                  const html = buildExecutiveReportHtml({
                    title: "Janis Commerce -  Care Executive Dashboard",
                    generatedAt: now,
                    filters: {
                      fromMonth: fromMonth === "all" ? autoRange.minMonth || "all" : fromMonth,
                      toMonth: toMonth === "all" ? autoRange.maxMonth || "all" : toMonth,
                      org: orgFilter === "all" ? "Todas" : orgFilter,
                      assignee: assigneeFilter === "all" ? "Todos" : assigneeFilter,
                      status: statusFilter === "all" ? "Todos" : statusFilter,
                    },
                    autoRange,
                    kpis: {
                      total: kpis.total,
                      latestMonth: kpis.latestMonth,
                      monthCount: kpis.monthCount,
                      respInc: kpis.respInc,
                      respOkPct: kpis.respOkPct,
                      csatAvg: kpis.csatAvg,
                      csatCoverage: kpis.csatCoverage,
                      tpp6m: kpis.tpp6m,
                      tppHealth: { label: kpis.tppHealth.label },
                    },
                    series,
                  });

                  await exportExecutivePdfDirect({ html, filename });
                  setError(null);
                } catch (e: any) {
                  console.error(e);
                  setError(
                    (e && (e.message || String(e))) ||
                      "No se pudo exportar (descarga directa). Si tu entorno no incluye html2canvas/jspdf, hay que agregarlos."
                  );
                } finally {
                  setExporting(false);
                }
              }}
            >
              {exporting ? "Exportando…" : "Exportar Informe"}
            </Button>

            <Button variant="outline" onClick={clearAll}>
              Limpiar
            </Button>
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700">
            {error}
          </div>
        ) : null}

        {isEmpty ? (
          <div className="mt-6 flex flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white p-6 text-center">
            <p className="text-base text-slate-600">
              Configura tu Dashboard en Simples Pasos y luego verás lo que esperas.
            </p>
          </div>
        ) : (
          <>
        {/* Filters */}
        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-5">
          <Card className={UI.card}>
            <CardContent className="p-4">
              <div className={UI.subtle}>Desde (mes)</div>
              <Input
                type="month"
                value={fromMonth === "all" ? (autoRange.minMonth || "") : fromMonth}
                min={minMonthBound || undefined}
                max={maxMonthBound || undefined}
                onChange={(e) => setFromMonth(e.target.value || "all")}
              />
            </CardContent>
          </Card>
          <Card className={UI.card}>
            <CardContent className="p-4">
              <div className={UI.subtle}>Hasta (mes)</div>
              <Input
                type="month"
                value={toMonth === "all" ? (autoRange.maxMonth || "") : toMonth}
                min={minMonthBound || undefined}
                max={maxMonthBound || undefined}
                onChange={(e) => setToMonth(e.target.value || "all")}
              />
            </CardContent>
          </Card>

          <Card className={UI.card}>
            <CardContent className="p-4">
              <div className={UI.subtle}>Organización</div>
              <Select value={orgFilter} onValueChange={setOrgFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {filterOptions.orgs.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card className={UI.card}>
            <CardContent className="p-4">
              <div className={UI.subtle}>Asignado</div>
              <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {filterOptions.assignees.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card className={UI.card}>
            <CardContent className="p-4">
              <div className={UI.subtle}>Estado</div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {filterOptions.estados.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
        </div>

        {/* KPIs */}
        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-5">
          {kpiCard("Tickets (vista)", formatInt(kpis.total), undefined, undefined, undefined, kpiExtras.tickets)}
          {kpiCard(
            "Tickets último mes (vista)",
            formatInt(kpis.monthCount),
            kpis.latestMonth ? monthLabel(kpis.latestMonth) : "—"
          )}
          {kpiCard(
            "Cumplimiento SLA Response",
            formatPct(kpis.respOkPct),
            `${formatInt(kpis.respInc)} incumplidos`,
            undefined,
            undefined,
            kpiExtras.sla
          )}
          {kpiCard(
            "CSAT promedio (por año)",
            kpis.csatAvg == null ? "—" : kpis.csatAvg.toFixed(2),
            `Cobertura: ${formatPct(kpis.csatCoverage)}`,
            undefined,
            undefined,
            kpiExtras.csat
          )}
          {kpiCard(
            "Tickets / Persona (últimos 6 meses)",
            kpis.tpp6m == null ? "—" : kpis.tpp6m.toFixed(1),
            "(excluye mes actual si no está cerrado)",
            undefined,
            <HealthBadge label={kpis.tppHealth.label} color={kpis.tppHealth.color} />,
            kpiExtras.tpp
          )}
        </div>

        {/* Charts */}
        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
          <Card className={UI.card}>
            <CardHeader>
              <CardTitle className={UI.title}>Tickets por Mes</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series.ticketsByMonth}>
                  <CartesianGrid stroke={UI.grid} />
                  <XAxis dataKey="month" tickFormatter={monthLabel as any} />
                  <YAxis />
                  <Tooltip labelFormatter={(l) => monthLabel(String(l))} />
                  <Line type="monotone" dataKey="tickets" stroke={UI.primary} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className={UI.card}>
            <CardHeader>
              <CardTitle className={UI.title}>Tickets por Año</CardTitle>
            </CardHeader>
            <CardContent>
              <YearBars rows={ticketsByYearBars.rows} maxTickets={ticketsByYearBars.maxTickets} />
            </CardContent>
          </Card>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
          <Card className={UI.card}>
            <CardHeader>
              <CardTitle className={UI.title}>SLA Respuesta por Año</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series.slaByYear}>
                  <CartesianGrid stroke={UI.grid} />
                  <XAxis dataKey="year" />
                  <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                  <Tooltip
                    formatter={(v: any, n: any) => [`${Number(v).toFixed(2)}%`, n]}
                    labelFormatter={(l) => `Año ${l}`}
                  />
                  <Legend />
                  <Bar dataKey="CumplidoPct" name="Cumplido" stackId="a" fill={UI.primary} />
                  <Bar dataKey="IncumplidoPct" name="Incumplido" stackId="a" fill={UI.warning} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className={UI.card}>
            <CardHeader>
              <CardTitle className={UI.title}>CSAT promedio por Año</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series.csatByYear}>
                  <CartesianGrid stroke={UI.grid} />
                  <XAxis dataKey="year" />
                  <YAxis />
                  <Tooltip
                    formatter={(v: any) => [Number(v).toFixed(2), "CSAT"]}
                    labelFormatter={(l) => `Año ${l}`}
                  />
                  <Bar dataKey="csatAvg" name="CSAT" fill={UI.primary} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
          <Card className={UI.card}>
            <CardHeader>
              <CardTitle className={UI.title}>Top 5 Organizaciones (torta) + Otros</CardTitle>
            </CardHeader>
            <CardContent className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip formatter={pieTooltipFormatter as any} />
                  <Pie
                    data={series.topOrgsPie}
                    dataKey="tickets"
                    nameKey="name"
                    outerRadius={110}
                    innerRadius={55}
                    paddingAngle={2}
                  >
                    {series.topOrgsPie.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className={UI.card}>
            <CardHeader>
              <CardTitle className={UI.title}>Top 10 Asignados</CardTitle>
            </CardHeader>
            <CardContent className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series.topAssignees} layout="vertical" margin={{ left: 60 }}>
                  <CartesianGrid stroke={UI.grid} />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="name" width={160} />
                  <Tooltip formatter={(v: any) => [formatInt(v), "Tickets"]} />
                  <Bar dataKey="tickets" fill={UI.primary} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Heatmaps */}
        <div className="mt-6 grid grid-cols-1 gap-3">
          <Card className={UI.card}>
            <CardHeader>
              <CardTitle className={UI.title}>Heatmap Mes vs Estado (últimos 6 meses)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className="p-2 border border-slate-200 bg-slate-50">Mes</th>
                      {series.heatMap.states.map((s) => (
                        <th key={s} className="p-2 border border-slate-200 bg-slate-50">
                          {s}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {series.heatMap.rows.map((r: any) => (
                      <tr key={r.month}>
                        <td className="p-2 border border-slate-200 font-semibold text-slate-700">
                          {monthLabel(r.month)}
                        </td>
                        {series.heatMap.states.map((s) => {
                          const v = Number(r[s] || 0);
                          const style = heatBg(v, heatMaxMonthState);
                          return (
                            <td key={s} className="p-2 border border-slate-200 text-center" style={style}>
                              {v ? formatInt(v) : ""}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Card className={UI.card}>
              <CardHeader>
                <CardTitle className={UI.title}>Heatmap Horario (por hora)</CardTitle>
              </CardHeader>
              <CardContent>
                <ShiftsLegend shifts={coverageShifts} />
                <div className="grid grid-cols-6 gap-2">
                  {series.hourHeatMap.data.map((x) => {
                    const sh = pickShiftForHour(coverageShifts, x.hour);
                    const baseColor = coverageKinds.split && sh?.kind === "guardia" ? UI.warning : UI.primary;
                    const base = heatBg(x.tickets, series.hourHeatMap.max, baseColor);
                    return (
                      <div
                        key={x.hour}
                        className="rounded-lg border border-slate-200 p-2 text-center"
                        style={{ ...base }}
                        title={sh ? sh.name : undefined}
                      >
                        <div className="text-xs font-semibold rounded px-1 py-0.5 inline-block" style={getShiftOverlayStyle(sh?.color)}>{String(x.hour).padStart(2, "0")}:00</div>
                        <div className="text-sm">{x.tickets ? formatInt(x.tickets) : ""}</div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card className={UI.card}>
              <CardHeader>
                <CardTitle className={UI.title}>Heatmap Semana (día vs hora)</CardTitle>
              </CardHeader>
              <CardContent>
                <ShiftsLegend shifts={coverageShifts} />
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="text-left">
                        <th className="p-2 border border-slate-200 bg-slate-50">Hora</th>
                        {series.weekHeatMap.days.map((d) => (
                          <th key={d} className="p-2 border border-slate-200 bg-slate-50">
                            {d}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {series.weekHeatMap.matrix.map((row: any) => (
                        <tr key={row.hour}>
                          <td className="p-2 border border-slate-200 font-semibold text-slate-700">
                            {String(row.hour).padStart(2, "0")}:00
                          </td>
                          {series.weekHeatMap.days.map((d) => {
                            const v = Number(row[d] || 0);
                            const dayIdx = DAY_TO_IDX[d] ?? null;
                            const sh = dayIdx === null ? null : pickShiftForDayHour(coverageShifts, dayIdx, row.hour);
                            const baseColor = coverageKinds.split && sh?.kind === "guardia" ? UI.warning : UI.primary;
                            const base = heatBg(v, series.weekHeatMap.max, baseColor);
                            return (
                              <td
                                key={d}
                                className="p-2 border border-slate-200 text-center"
                                style={{ ...base }}
                                title={sh ? sh.name : undefined}
                              >
                                {v ? formatInt(v) : ""}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="mt-6 text-xs text-slate-500">
          Sugerencia: aplica enfoque Pareto 80/20 sobre Top Organizaciones/Asignados para reducir demanda recurrente.
        </div>
          </>
        )}
      </div>
    </div>
  );
}
