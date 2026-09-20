import type { FundamentalContext, CalendarEventContext } from "./replacement-intelligence";
import { isBtcNewsExcluded, type V7Asset } from "./v7-intelligence";

export type V7NewsObservation = {
  asset: V7Asset;
  event: string;
  impact: string;
  eventTime: string;
  phase: "REMINDER_1D" | "REMINDER_1H" | "RELEASE_WARNING";
  actual: string;
  forecast: string;
  previous: string;
  surprise: string;
  provisionalInterpretation: string;
  confirmedByPrice: false;
  blocksOrdinaryChannel: false;
  dedupeKey: string;
};

function numeric(value: string | undefined) {
  if (!value) return null;
  const n = Number(value.replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function eventTime(event: CalendarEventContext) { const time = new Date(event.date).getTime(); return Number.isFinite(time) ? time : null; }
function phaseFor(event: CalendarEventContext, nowMs: number): V7NewsObservation["phase"] | null {
  const at = eventTime(event); if (at == null) return null;
  const minutes = (at - nowMs) / 60_000;
  if (minutes >= 1_380 && minutes <= 1_500) return "REMINDER_1D";
  if (minutes >= 45 && minutes <= 75) return "REMINDER_1H";
  if (minutes >= -5 && minutes <= 5 && event.actual) return "RELEASE_WARNING";
  return null;
}

export function buildV7NewsObservations(asset: V7Asset, context: FundamentalContext | null | undefined, now = new Date()): V7NewsObservation[] {
  if (isBtcNewsExcluded(asset) || !context?.calendarEvents?.length || context.calendarStatus !== "AVAILABLE") return [];
  return context.calendarEvents.flatMap((event) => {
    if (String(event.impact).toUpperCase() !== "HIGH") return [];
    const phase = phaseFor(event, now.getTime()); if (!phase) return [];
    const actual = event.actual ?? "—"; const forecast = event.forecast ?? "—"; const previous = event.previous ?? "—";
    const a = numeric(event.actual); const f = numeric(event.forecast);
    const surprise = a != null && f != null ? `${(a - f).toFixed(4)} vs forecast` : "not available";
    const provisionalInterpretation = a == null || f == null ? "Headline direction is provisional; actual/forecast surprise is incomplete." : a > f ? "Actual exceeded forecast; provisional directional pressure may differ by asset. Price-action confirmation is required." : a < f ? "Actual missed forecast; provisional directional pressure may differ by asset. Price-action confirmation is required." : "Actual matched forecast; provisional directional pressure is neutral until price confirms.";
    return [{ asset, event: event.title, impact: event.impact, eventTime: event.date, phase, actual, forecast, previous, surprise, provisionalInterpretation, confirmedByPrice: false, blocksOrdinaryChannel: false, dedupeKey: `v7-news:${asset}:${event.title}:${event.date}:${phase}` }];
  });
}
