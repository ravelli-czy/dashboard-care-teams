export type DateRange = { start: Date; end: Date }; // end exclusivo

export function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

export function daysBetween(start: Date, end: Date) {
  const ms = end.getTime() - start.getTime();
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
}

/** período inmediatamente anterior, misma duración */
export function previousSameLength(range: DateRange): DateRange {
  const len = daysBetween(range.start, range.end);
  return { start: addDays(range.start, -len), end: range.start };
}

/** mismo período año anterior (mismas fechas) */
export function yearOverYear(range: DateRange): DateRange {
  const s = new Date(range.start);
  const e = new Date(range.end);
  s.setFullYear(s.getFullYear() - 1);
  e.setFullYear(e.getFullYear() - 1);
  return { start: s, end: e };
}

export function formatRangeEs(range: DateRange) {
  const fmt = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", year: "numeric" });
  // end es exclusivo, le resto 1 día para mostrarlo humano
  const endHuman = addDays(range.end, -1);
  return `${fmt.format(range.start)} → ${fmt.format(endHuman)}`;
}

export function safePctChange(current: number, previous: number) {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}
