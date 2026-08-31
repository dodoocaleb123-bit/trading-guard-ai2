import { COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { parse as parseCookie } from "cookie";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { appSettings, auditMessages, auditTrades, generatedSignals } from "../drizzle/schema";
import { activateIntelligenceVersion, createIntelligenceComponent, createIntelligenceVersion, createStrategyRule, getActiveIntelligenceVersion, getDb, getRelevantRulesText, getAllRulesText, getSettings, getSignalDeliverySummary, listRecentScannerRuns, listOpenCurrentV5Signals, getScannerCadenceDiagnostics, getStrategyDecisionSummary, getStrategyEngineHealth, getReplacementOutcomeStats, getLocatorV5OutcomeStats, getAdaptiveRatioStats, getV5SourceStats, getWinningRateStats, listExcludedWinningRateSignals, getBestTimeToTradeStats, getBestDaysToTradeStats, getV5MonitoringStats, getV5HierarchySmokeStatus, getLiveMarketPulse, listEntryLocatorStates, listV5ZoneHistory, listAcceptedStrategyLessons, listPaperTradeAdjustments, listPaperTradeUpgradeChains, getPaperTradeUpgradeSummary, listAuditMessages, listAuditTrades, listCooldownChanges, listGeneratedSignals, listGeneratedSignalsSince, listStrategyDecisionsSince, listStrategyDecisionsForDashboard, listIntelligenceComponents, listIntelligenceVersions, listStrategyDecisions, listStrategyLessons, listStrategyRuleSummaries, listStrategyRules, listWhiteAiMemories, rememberWhiteAiConversation, markOnboardingComplete, recordCooldownChange, updateSetupCooldown, updateStrategyLessonStatus, updateStrategyLessonPatternStatus } from "./db";
import { serializeDecisionLedgerCsv, serializeDecisionLedgerJson } from "./decision-ledger";
import { extractStrategyText, fetchMarketSeries, fetchStrategyRulesFromSupabase, formatAuditResult, mirrorToSupabase, normalizeAsset, type MarketSnapshot } from "./integrations";
import { buildIntelligenceModel, buildLessonPromotionPlan, compileExecutableComponents, resolveLessonPatternReview } from "./intelligence";
import { buildReplacementKnowledgeModelV5, evaluateReplacementIntelligence, type ReplacementDecision } from "./replacement-intelligence";
import { invokeLLM } from "./_core/llm";
import { fetchOfficialMacroContext } from "./official-macro";
import { createHeartbeatJob, listHeartbeatJobs } from "./_core/heartbeat";
import { buildCallbackStatus, selectScannerSchedulerJob } from "./scheduler-status";
import { getSessionCookieOptions } from "./_core/cookies";

const CHAT_ASSETS = [{ symbol: "EUR/USD", label: "Euro / US dollar" }, { symbol: "XAU/USD", label: "Gold / US dollar" }, { symbol: "GBP/USD", label: "Pound / US dollar" }, { symbol: "BTC/USD", label: "Bitcoin / US dollar" }] as const;

export function summarizeChatSignals(signals: Array<{ asset: string; status: string }>) {
  return Array.from(new Set(signals.map((signal) => signal.asset))).map((asset) => {
    const rows = signals.filter((signal) => signal.asset === asset);
    const resolved = rows.filter((signal) => signal.status === "WIN" || signal.status === "LOSS");
    const wins = rows.filter((signal) => signal.status === "WIN").length;
    return { asset, generated: rows.length, resolved: resolved.length, wins, losses: rows.filter((signal) => signal.status === "LOSS").length, winRate: resolved.length ? Math.round((wins / resolved.length) * 100) : null };
  });
}

export function formatChatServiceError(error: unknown, assistantName: string): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const normalized = raw.toLowerCase();
  if (normalized.includes("429") || normalized.includes("rate limit") || normalized.includes("quota")) return `${assistantName} is temporarily rate-limited. Please try again shortly.`;
  if (normalized.includes("service unavailable") || normalized.includes("unavailable") || normalized.includes("timeout") || normalized.includes("failed to fetch") || normalized.includes("cannot read properties") || normalized.includes("is not a function") || normalized.includes("missing readable") || normalized.includes("invalid response")) return `${assistantName} is temporarily unavailable because the response service did not return a valid response. Please try again in a moment.`;
  return raw.trim() || `${assistantName} could not respond. Please try again shortly.`;
}

export function normalizeChatResponseContent(content: unknown): string {
  if (typeof content === "string" && content.trim()) return content;
  if (Array.isArray(content)) {
    const text: string = content.map((part) => normalizeChatResponseContent(part)).filter(Boolean).join("\n").trim();
    if (text) return text;
  }
  if (content && typeof content === "object") {
    const candidate = content as { text?: unknown; content?: unknown };
    const text: string = normalizeChatResponseContent(candidate.text ?? candidate.content);
    if (text) return text;
  }
  return "The assistant returned no readable text for this question. Please try again; no trade decision was created.";
}

export function compactWhiteAiJson(value: unknown, maxChars = 24000) {
  const serialized = JSON.stringify(value);
  return serialized.length > maxChars ? `${serialized.slice(0, maxChars)}…` : serialized;
}

export function buildWhiteAiAnalyticsContext(input: { winningRate: unknown; bestTime: unknown; bestDays: unknown; locatorOutcomes: unknown; sourceStats: unknown }) {
  const winningRate = input.winningRate as { versions?: Array<{ version: string; overall: unknown; assets: unknown; timeframes: unknown }> };
  const compactWinningRate = { ...(winningRate ?? {}), versions: (winningRate?.versions ?? []).map((version) => ({ version: version.version, overall: version.overall, assets: version.assets, timeframes: version.timeframes })) };
  const compactTiming = (value: unknown) => {
    const groups = (value as { groups?: Array<{ version: string; asset: string; timeframe: string; buckets: Array<{ label: string; resolved: number; wins: number; losses: number; winRate: number | null }> }> } | null)?.groups ?? [];
    return groups.flatMap((group) => group.buckets.filter((bucket) => bucket.resolved > 0).map((bucket) => ({ version: group.version, asset: group.asset, timeframe: group.timeframe, ...bucket }))).sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1)).slice(0, 12);
  };
  return { winningRate: compactWinningRate, bestTime: compactTiming(input.bestTime), bestDays: compactTiming(input.bestDays), locatorOutcomes: input.locatorOutcomes, sourceStats: input.sourceStats };
}

export function buildWhiteAiZoneContext(states: Array<{ asset: string; timeframe: string; status: string; snapshotCount: number; lastSnapshotAt: Date | string | null; stateJson?: string | null }>, asset: string, timeframe: string, history: Array<{ zoneKind: string; lower: string | number; upper: string | number; reactions: number; displacement: string | number; fresh: boolean; weakFor: string | null; lifecycle: string; observationCount: number; retestCount: number; firstSeenAt: Date | string; lastSeenAt: Date | string; lastRetestedAt: Date | string | null }> = []) {
  const state = states.find((row) => row.asset === asset && row.timeframe === timeframe);
  if (!state) return { asset, timeframe, found: false, reason: "No persisted Entry Locator state was found for this asset and timeframe." };
  let lastSnapshot: Record<string, unknown> | null = null;
  let zoneEvidence: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(state.stateJson ?? "{}");
    const snapshots = Array.isArray(parsed?.snapshots) ? parsed.snapshots : [];
    lastSnapshot = snapshots.length ? snapshots[snapshots.length - 1] : null;
    zoneEvidence = parsed?.zoneEvidence && typeof parsed.zoneEvidence === "object" ? parsed.zoneEvidence : parsed;
  } catch {
    lastSnapshot = null;
  }
  const historicalZones = history.filter((row) => row.lifecycle !== "INVALIDATED").map((row) => ({ kind: row.zoneKind, lower: Number(row.lower), upper: Number(row.upper), reactions: row.reactions, displacement: Number(row.displacement), fresh: row.fresh, weakFor: row.weakFor ? row.weakFor.split(",").filter(Boolean) : [], timeframe, lifecycle: row.lifecycle, observationCount: row.observationCount, retestCount: row.retestCount, firstSeenAt: row.firstSeenAt, lastSeenAt: row.lastSeenAt, lastRetestedAt: row.lastRetestedAt }));
  const zones = historicalZones.length ? historicalZones : (Array.isArray(zoneEvidence.zones) ? zoneEvidence.zones : []);
  return { asset, timeframe, found: true, status: state.status, snapshotCount: state.snapshotCount, historicalZoneCount: historicalZones.length, lastSnapshotAt: state.lastSnapshotAt, observedAt: lastSnapshot?.observedAt ?? zoneEvidence.candleAt ?? null, breakoutState: lastSnapshot?.breakoutState ?? zoneEvidence.breakoutState ?? null, nextResistance: lastSnapshot?.nextResistance ?? zoneEvidence.nextResistance ?? null, nextSupport: lastSnapshot?.nextSupport ?? zoneEvidence.nextSupport ?? null, targetBoundary: lastSnapshot?.targetBoundary ?? zoneEvidence.targetBoundary ?? null, supportZone: zoneEvidence.supportZone ?? null, resistanceZone: zoneEvidence.resistanceZone ?? null, zones, supportingComponents: Array.isArray(lastSnapshot?.supportingComponents) ? lastSnapshot.supportingComponents : [], indicatorEvidence: Array.isArray(lastSnapshot?.indicatorEvidence) ? lastSnapshot.indicatorEvidence : [], waitReason: lastSnapshot?.waitReason ?? null };
}

export function formatWhiteAiZoneFallback(zoneContext: ReturnType<typeof buildWhiteAiZoneContext>) {
  if (!zoneContext.found) return `I could not find a persisted v5 Entry Locator state for ${zoneContext.asset} on ${zoneContext.timeframe}. I will not invent zone levels. This is analysis only — paper trading only — UNVALIDATED.`;
  const level = (value: unknown) => value == null ? "not recorded" : String(value);
  const zones = Array.isArray(zoneContext.zones) ? zoneContext.zones.map((zone: any) => `${zone.kind ?? "ZONE"} ${zone.lower ?? "?"}–${zone.upper ?? "?"} (${zone.timeframe ?? zoneContext.timeframe}; reactions ${zone.reactions ?? "?"}; ${zone.fresh ? "fresh" : "retested/older"})`).join("; ") : "none recorded";
  return `Persisted v5 zone evidence for ${zoneContext.asset} on ${zoneContext.timeframe}: status ${zoneContext.status}; ${zoneContext.snapshotCount} snapshots; latest observation ${zoneContext.observedAt ?? zoneContext.lastSnapshotAt ?? "not recorded"}. Detected zones: ${zones}. Support zone: ${level(zoneContext.supportZone)}. Resistance zone: ${level(zoneContext.resistanceZone)}. Next resistance/opposing upper level: ${level(zoneContext.nextResistance)}. Next support/opposing lower level: ${level(zoneContext.nextSupport)}. Target boundary: ${level(zoneContext.targetBoundary)}. Breakout state: ${level(zoneContext.breakoutState)}. These are recorded locator levels, not a chart image or a guarantee of future movement. This is analysis only — paper trading only — UNVALIDATED.`;
}

export function shouldUseDeterministicZoneFallback(channel: "WHITE" | "CHERRY", asksForZoneEvidence: boolean, zoneContext: unknown): boolean {
  return channel === "WHITE" && asksForZoneEvidence && zoneContext != null;
}

export function buildWhiteAiSignalContext(signals: Array<{ id: number; asset: string; timeframe: string; direction: string; entry: string | number | null; stopLoss: string | number | null; takeProfit: string | number | null; riskReward: string | number | null; confidence: string | number | null; confluenceScore: string | number | null; rationale?: string | null; status: string; outcomeNote?: string | null; openedAt: Date | string | null; closedAt?: Date | string | null; telegramDelivery?: { status: string; deliveredAt?: Date | string | null } | null }>, asset: string) {
  const normalizedAsset = normalizeAsset(asset);
  const signal = signals.filter((row) => normalizeAsset(row.asset) === normalizedAsset).sort((a, b) => new Date(b.openedAt ?? 0).getTime() - new Date(a.openedAt ?? 0).getTime())[0];
  if (!signal) return { asset, found: false, reason: "No persisted v5 signal was found for this asset." };
  const number = (value: string | number | null) => value == null ? null : Number(value);
  const entry = number(signal.entry);
  const stopLoss = number(signal.stopLoss);
  const takeProfit = number(signal.takeProfit);
  const stopDistance = entry != null && stopLoss != null ? Math.abs(entry - stopLoss) : null;
  const targetDistance = entry != null && takeProfit != null ? Math.abs(takeProfit - entry) : null;
  const calculatedRiskReward = stopDistance && targetDistance != null ? targetDistance / stopDistance : null;
  return { found: true as const, id: signal.id, asset: signal.asset, timeframe: signal.timeframe, direction: signal.direction, entry, stopLoss, takeProfit, recordedRiskReward: number(signal.riskReward), calculatedRiskReward, stopDistance, targetDistance, confidence: number(signal.confidence), confluenceScore: number(signal.confluenceScore), rationale: signal.rationale ?? null, status: signal.status, outcomeNote: signal.outcomeNote ?? null, openedAt: signal.openedAt, closedAt: signal.closedAt ?? null, telegramDelivery: signal.telegramDelivery ?? null };
}

export function formatWhiteAiSignalFallback(signalContext: ReturnType<typeof buildWhiteAiSignalContext>) {
  if (!signalContext.found) return `I could not find a persisted v5 signal for ${signalContext.asset}. I will not invent an explanation. This is analysis only — paper trading only — UNVALIDATED.`;
  const value = (item: unknown) => item == null || (typeof item === "number" && !Number.isFinite(item)) ? "not recorded" : String(item);
  const calculatedRiskReward = Number((signalContext as { calculatedRiskReward?: number | null }).calculatedRiskReward);
  const ratio = Number.isFinite(calculatedRiskReward) ? `approximately 1:${calculatedRiskReward.toFixed(2)}` : "not calculable from the recorded levels";
  return `Analysis only — paper trading only — UNVALIDATED. The most recent persisted v5 ${signalContext.asset} signal was ${signalContext.direction} on ${signalContext.timeframe}. Entry: ${value(signalContext.entry)}. Stop loss: ${value(signalContext.stopLoss)}. Take profit: ${value(signalContext.takeProfit)}. The recorded stop distance from entry is ${value(signalContext.stopDistance)}, while the target distance is ${value(signalContext.targetDistance)}; those levels calculate to ${ratio}. The signal recorded risk/reward as ${value(signalContext.recordedRiskReward)}. The stop was recorded by the v5/Entry Locator plan; the available rationale is: ${signalContext.rationale || "not recorded"}. White AI is explaining the stored decision only and cannot alter the v5 workflow.`;
}
import { systemRouter } from "./_core/systemRouter";

export function buildStrategyRuleRecord(input: { userId: number; title: string; sourceType: "pdf" | "docx" | "text"; fileName: string; content: string; storageKey: string | null; supabaseId: string | null }) {
  return { userId: input.userId, title: input.title, sourceType: input.sourceType, sourceFileName: input.fileName, content: input.content, storageKey: input.storageKey, supabaseId: input.supabaseId };
}

export function isCompleteTradeIdea(signal: string): boolean {
  const hasDirection = /\b(BUY|SELL)\b/i.test(signal);
  const hasPriceField = /\b(entry|stop\s*loss|take\s*profit|tp|sl)\s*[:=]/i.test(signal);
  return hasDirection && hasPriceField;
}

export function buildReplacementManualAuditResult(signal: string, asset: string, timeframe: "15MIN" | "5MIN" | "1H", market: MarketSnapshot, decision: ReplacementDecision) {
  const submittedDirection = signal.match(/\b(BUY|SELL)\b/i)?.[1]?.toUpperCase() as "BUY" | "SELL" | undefined;
  const directionMatches = !submittedDirection || submittedDirection === decision.direction;
  const directionReason = submittedDirection
    ? directionMatches
      ? `Submitted ${submittedDirection} direction matches Replacement Intelligence v5.`
      : `Submitted ${submittedDirection} direction conflicts with Replacement Intelligence v5 ${decision.direction} judgment.`
    : `No explicit direction was detected in the submitted signal; the audit uses the intelligence direction ${decision.direction}.`;
  const trace = `Score: BUY ${decision.score.buy} vs SELL ${decision.score.sell}; confluence ${decision.confluenceScore}%; market regime ${decision.marketRegime}. ${decision.conflicts.length ? `Conflicting components: ${decision.conflicts.join("; ")}.` : "No conflicting components were matched."}`;
  const adjustments = `${directionReason} ${decision.explanation} ${trace} Additive source-linked replacement v5 is authoritative for this paper audit; it retains the complete v2 foundation and uses verified macro/fundamental evidence when available. Validation remains UNVALIDATED.`;
  return {
    verdict: directionMatches ? "APPROVED" as const : "DENIED" as const,
    confidence: decision.confidence,
    adjustments,
    asset,
    timeframe,
    direction: decision.direction,
    entry: decision.entry,
    stopLoss: decision.stopLoss,
    takeProfit: decision.takeProfit,
    ruleEvidence: decision.ruleEvidence,
    ruleFindings: decision.ruleFindings,
    confluenceScore: decision.confluenceScore,
    validationStatus: "UNVALIDATED" as const,
    market,
  };
}

export function buildStrategyContext(localRules: string, supabaseRules: Array<{ title?: string; content?: string }>) {
  const mirrored = supabaseRules.filter((rule) => rule.content).map((rule) => `## ${rule.title ?? "Saved strategy rule"}\n${rule.content}`).join("\n\n");
  return [localRules, mirrored].filter(Boolean).join("\n\n");
}

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  settings: router({
    get: protectedProcedure.query(({ ctx }) => getSettings(ctx.user.id)),
  }),
  intelligence: router({
    status: protectedProcedure.query(async ({ ctx }) => {
      const active = await getActiveIntelligenceVersion(ctx.user.id);
      const versions = await listIntelligenceVersions(ctx.user.id);
      const components = active ? await listIntelligenceComponents(ctx.user.id, active.id) : [];
      const lessons = await listStrategyLessons(ctx.user.id);
      const promotionPlan = buildLessonPromotionPlan(lessons);
      return { active, versions, components, lessons, promotionPlan, acceptedLessonCount: lessons.filter((lesson) => lesson.status === "ACCEPTED").length };
    }),
    replacementPreview: protectedProcedure.query(async ({ ctx }) => {
      const model = buildReplacementKnowledgeModelV5();
      const active = await getActiveIntelligenceVersion(ctx.user.id);
      return { id: model.id, sourceDocument: model.sourceDocument, nodeCount: model.nodes.length, nodes: model.nodes, decisionPolicy: model.decisionPolicy, learningPolicy: model.learningPolicy, active: active?.versionLabel?.startsWith(model.id) ?? false, activeVersionId: active?.id ?? null };
    }),
    replacementOutcomeStats: protectedProcedure.query(({ ctx }) => getReplacementOutcomeStats(ctx.user.id)),
    locatorV5OutcomeStats: protectedProcedure.query(({ ctx }) => getLocatorV5OutcomeStats(ctx.user.id)),
    adaptiveRatioStats: protectedProcedure.input(z.object({ asset: z.string().optional(), timeframe: z.enum(["15MIN", "5MIN", "1H"]).optional() }).optional()).query(({ ctx, input }) => getAdaptiveRatioStats(ctx.user.id, input ?? {})),
    v5SourceStats: protectedProcedure.input(z.object({ asset: z.string().optional(), timeframe: z.enum(["15MIN", "5MIN", "1H"]).optional(), source: z.enum(["ENTRY_LOCATOR"]).optional() }).optional()).query(({ ctx, input }) => getV5SourceStats(ctx.user.id, input ?? {})),
    v5Monitoring: protectedProcedure.query(({ ctx }) => getV5MonitoringStats(ctx.user.id)),
    entryLocator: protectedProcedure.query(({ ctx }) => listEntryLocatorStates(ctx.user.id)),
    winningRateStats: protectedProcedure.query(({ ctx }) => getWinningRateStats(ctx.user.id)),
    excludedWinningRateSignals: protectedProcedure.input(z.object({ limit: z.number().int().min(1).max(500).optional() }).optional()).query(({ ctx, input }) => listExcludedWinningRateSignals(ctx.user.id, input?.limit ?? 100)),
    bestTimeToTradeStats: protectedProcedure.query(({ ctx }) => getBestTimeToTradeStats(ctx.user.id)),
    bestDaysToTradeStats: protectedProcedure.query(({ ctx }) => getBestDaysToTradeStats(ctx.user.id)),
    macroStatus: protectedProcedure.query(async () => {
      const assets = ["EUR/USD", "XAU/USD", "GBP/USD", "BTC/USD"] as const;
      return Promise.all(assets.map(async (asset) => ({ asset, context: await fetchOfficialMacroContext(asset) })));
    }),
    reviewLessonPattern: protectedProcedure.input(z.object({ outcome: z.enum(["WIN", "LOSS"]), patternKey: z.string().min(1), decision: z.enum(["ACCEPT", "REJECT"]) })).mutation(async ({ ctx, input }) => {
      const lessons = await listStrategyLessons(ctx.user.id);
      const plan = buildLessonPromotionPlan(lessons);
      const reviewDecision = resolveLessonPatternReview(plan, input);
      if (!reviewDecision.ok) throw new Error(reviewDecision.error);
      const status = reviewDecision.status;
      const result = await updateStrategyLessonPatternStatus(ctx.user.id, input.outcome, input.patternKey, status);
      return { ...result, outcome: input.outcome, patternKey: input.patternKey, status, explanation: input.decision === "ACCEPT" ? "Pattern accepted for paper-only v3 learning; it remains UNVALIDATED." : "Pattern rejected; its proposed lessons will not influence future v3 decisions." };
    }),
    promoteLessons: protectedProcedure.mutation(async ({ ctx }) => {
      const lessons = await listStrategyLessons(ctx.user.id);
      const plan = buildLessonPromotionPlan(lessons);
      if (plan.eligible.length === 0) return { promoted: false, ...plan };
      const model = buildReplacementKnowledgeModelV5();
      const version = await createIntelligenceVersion({ userId: ctx.user.id, versionLabel: `forex-trading-combined-document-v5-lessons-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`, status: "ACTIVE", sourceRuleCount: 0, componentCount: model.nodes.length, lessonCount: plan.eligible.length, algorithmJson: JSON.stringify({ ...model, promotedLessonIds: plan.eligible.map((lesson) => lesson.id), learning: { status: "paper-only", application: "accepted-lessons-are-applied-by-v5-with-pattern-matching" } }), validationJson: JSON.stringify({ status: "UNVALIDATED", reason: "Accepted loss-learning adjustments remain paper-validation only and can be rolled back by retiring this version." }), activatedAt: new Date() });
      const triggerFor = (family: string) => family === "STRUCTURE" ? "MARKET_STRUCTURE" : family === "LEVELS" ? "SUPPORT_RESISTANCE" : family === "PATTERN" ? "BREAKOUT" : family === "INDICATOR" ? "MOMENTUM" : family === "VOLUME" ? "VOLATILITY" : "CANDLE";
      for (const node of model.nodes) await createIntelligenceComponent({ userId: ctx.user.id, versionId: version.id, title: node.concept, sourceRuleIds: JSON.stringify([]), trigger: triggerFor(node.family) as any, stance: "NEUTRAL", conditionJson: JSON.stringify({ values: node.prerequisites, description: node.rule }), weight: "1", enabled: true });
      await activateIntelligenceVersion(ctx.user.id, version.id);
      for (const lesson of plan.eligible) await updateStrategyLessonStatus(ctx.user.id, lesson.id, "ACCEPTED", version.id);
      return { promoted: true, versionId: version.id, promotedLessonIds: plan.eligible.map((lesson) => lesson.id), explanation: plan.explanation };
    }),
    rebuild: protectedProcedure.mutation(async ({ ctx }) => {
      const rules = await listStrategyRules(ctx.user.id);
      const components = compileExecutableComponents(rules);
      const version = await createIntelligenceVersion({ userId: ctx.user.id, versionLabel: `intelligence-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`, status: "ACTIVE", sourceRuleCount: rules.length, componentCount: components.length, lessonCount: 0, algorithmJson: JSON.stringify({ ...buildIntelligenceModel(components), learning: { status: "paper-only", promotion: "validated-lessons-only" } }), validationJson: JSON.stringify({ status: "UNVALIDATED", reason: "Requires forward paper-validation evidence before claiming accuracy." }), activatedAt: new Date() });
      for (const component of components) await createIntelligenceComponent({ userId: ctx.user.id, versionId: version.id, title: component.title, sourceRuleIds: JSON.stringify(component.sourceRuleIds), trigger: component.trigger, stance: component.stance, conditionJson: JSON.stringify(component.condition), weight: String(component.weight), enabled: true });
      await activateIntelligenceVersion(ctx.user.id, version.id);
      return { versionId: version.id, sourceRuleCount: rules.length, componentCount: components.length };
    }),
  }),
  rules: router({
    list: protectedProcedure.query(({ ctx }) => listStrategyRuleSummaries(ctx.user.id)),
    supabaseList: protectedProcedure.query(() => fetchStrategyRulesFromSupabase()),
    ingest: protectedProcedure
      .input(z.object({ fileName: z.string(), mimeType: z.string(), sourceType: z.enum(["pdf", "docx", "text"]), title: z.string().min(1), contentBase64: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const buffer = Buffer.from(input.contentBase64, "base64");
        const content = await extractStrategyText(buffer, input.mimeType, input.fileName);
        if (!content) throw new Error("No readable strategy text was found in this file");
        // Persist extracted strategy text and metadata in the database. Binary file storage is optional.
        const supabase = await mirrorToSupabase("strategy_rules", { title: input.title, content, source_file_name: input.fileName, source_type: input.sourceType, storage_key: null });
        const rule = await createStrategyRule(buildStrategyRuleRecord({ userId: ctx.user.id, title: input.title, sourceType: input.sourceType, fileName: input.fileName, content, storageKey: null, supabaseId: supabase?.id ? String(supabase.id) : null }));
        await markOnboardingComplete(ctx.user.id);
        return rule;
      }),
  }),
  audit: router({
    history: protectedProcedure.input(z.object({ channel: z.enum(["WHITE", "CHERRY"]).default("WHITE") }).optional()).query(({ ctx, input }) => listAuditMessages(ctx.user.id, input?.channel ?? "WHITE")),
    memory: protectedProcedure.query(({ ctx }) => listWhiteAiMemories(ctx.user.id, 100)),
    clearConversation: protectedProcedure.input(z.object({ channel: z.enum(["WHITE", "CHERRY"]).default("WHITE") }).optional()).mutation(async ({ ctx, input }) => { const db = await getDb(); if (!db) throw new Error("Database unavailable"); await db.delete(auditMessages).where(and(eq(auditMessages.userId, ctx.user.id), eq(auditMessages.channel, input?.channel ?? "WHITE"))); return { cleared: true }; }),
    run: protectedProcedure.input(z.object({ signal: z.string().min(8) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      await db.insert(auditMessages).values({ userId: ctx.user.id, channel: "CHERRY", role: "user", content: input.signal });
      const assetMatch = input.signal.match(/(?:asset|symbol)\s*:\s*([A-Za-z/]+)|\b(EUR\/?USD|GBP\/?USD|XAU\/?USD|BTC\/?USD)\b/i);
      const asset = normalizeAsset(assetMatch?.[1] ?? assetMatch?.[2] ?? "EUR/USD");
      const timeframeMatch = input.signal.match(/(?:timeframe|tf)\s*[:=]\s*(15\s*MIN|5\s*MIN|1\s*H|15M|5M|1H)\b/i) ?? input.signal.match(/\b(15\s*MIN|5\s*MIN|1\s*H|15M|5M|1H)\b/i);
      const timeframeToken = timeframeMatch?.[1]?.replace(/\s+/g, "").toUpperCase();
      const timeframe: "15MIN" | "5MIN" | "1H" = timeframeToken === "1H" ? "1H" : timeframeToken === "5M" ? "5MIN" : "15MIN";
      try {
        const series = await fetchMarketSeries(asset, timeframe === "1H" ? "1h" : timeframe === "5MIN" ? "5min" : "15min");
        if (!series.marketContext) throw new Error("Latest scanner market context is unavailable");
        const fundamentalContext = await fetchOfficialMacroContext(asset);
        const market: MarketSnapshot = { symbol: series.symbol, price: series.close, close: series.close, fetchedAt: series.fetchedAt, interval: timeframe === "1H" ? "1h" : timeframe === "5MIN" ? "5min" : "15min", trend: series.trend, values: series.values, marketContext: series.marketContext, fundamentalContext };
        const acceptedLessons = await listAcceptedStrategyLessons(ctx.user.id);
        const decision = evaluateReplacementIntelligence({ asset, close: series.close, interval: series.interval, marketContext: series.marketContext, fundamentalContext, acceptedLessons }, buildReplacementKnowledgeModelV5());
        const result = buildReplacementManualAuditResult(input.signal, asset, timeframe, market, decision);
        const assistantText = formatAuditResult(result, market);
        await db.insert(auditMessages).values({ userId: ctx.user.id, channel: "CHERRY", role: "assistant", content: assistantText, verdict: result.verdict, confidence: String(result.confidence), asset });
        const [auditTradeInsert] = await db.insert(auditTrades).values({ userId: ctx.user.id, asset, timeframe: result.timeframe || "15MIN", direction: result.direction, entry: result.entry ? String(result.entry) : null, stopLoss: result.stopLoss ? String(result.stopLoss) : null, takeProfit: result.takeProfit ? String(result.takeProfit) : null, verdict: result.verdict, confidence: String(result.confidence), adjustments: result.adjustments });
        const auditTradeId = Number(auditTradeInsert.insertId);
        await mirrorToSupabase("audited_signals", { user_id: ctx.user.id, signal: input.signal, verdict: result.verdict, confidence: result.confidence, adjustments: result.adjustments, asset });
        return { role: "assistant" as const, content: assistantText, verdict: result.verdict, confidence: result.confidence, telegramDelivered: false };
      } catch (error) {
        const content = `TRADE DENIED\\n\\nConfidence level: 0%\\n\\nAdjustments: Live market data or strategy rules were unavailable. No decision should be made without a verified market snapshot.`;
        await db.insert(auditMessages).values({ userId: ctx.user.id, channel: "CHERRY", role: "assistant", content, verdict: "DENIED", confidence: "0", asset });
        return { role: "assistant" as const, content, verdict: "DENIED" as const, confidence: 0, error: error instanceof Error ? error.message : "Audit unavailable" };
      }
    }),
    conversation: protectedProcedure.input(z.object({ channel: z.enum(["WHITE", "CHERRY"]).default("WHITE"), messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(12000) })).min(1).max(24) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const chatMessages = input.messages.slice(-12).map((message) => ({ role: message.role, content: message.content.slice(-3000) }));
      const latest = chatMessages[chatMessages.length - 1].content;
      const userMessageInsert = await db.insert(auditMessages).values({ userId: ctx.user.id, channel: input.channel, role: "user", content: latest });
      if (input.channel === "WHITE") await rememberWhiteAiConversation(ctx.user.id, latest, Number(userMessageInsert[0].insertId));
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const assetMatch = latest.match(/\b(EUR\/?USD|GBP\/?USD|XAU\/?USD|BTC\/?USD)\b/i);
      const requestedAsset = assetMatch ? normalizeAsset(assetMatch[1]) : null;
      const requestedTimeframe = /\b(1\s*h|1h|hour)\b/i.test(latest) ? "1H" : /\b(5\s*m|5m|5\s*min|5min)\b/i.test(latest) ? "5MIN" : "15MIN";
      const [signals, rulesText, documentText, judgment, cadence, smoke, locatorStates, zoneHistory, recentDecisions, memories, winningRate, bestTime, bestDays, locatorOutcomes, sourceStats, recentSignalRecords] = await Promise.all([
        listGeneratedSignalsSince(ctx.user.id, since, 500),
        getRelevantRulesText(ctx.user.id, latest, 12000),
        getAllRulesText(ctx.user.id, 30000),
        getStrategyDecisionSummary(ctx.user.id),
        getScannerCadenceDiagnostics(ctx.user.id),
        getV5HierarchySmokeStatus(ctx.user.id),
        listEntryLocatorStates(ctx.user.id),
        listV5ZoneHistory(ctx.user.id, requestedAsset ?? undefined, requestedTimeframe),
        listStrategyDecisionsSince(ctx.user.id, since),
        input.channel === "WHITE" ? listWhiteAiMemories(ctx.user.id, 40) : Promise.resolve([]),
        getWinningRateStats(ctx.user.id),
        getBestTimeToTradeStats(ctx.user.id),
        getBestDaysToTradeStats(ctx.user.id),
        getLocatorV5OutcomeStats(ctx.user.id),
        getV5SourceStats(ctx.user.id, {}),
        listGeneratedSignals(ctx.user.id, requestedAsset),
      ]);
      let marketText = "No live market snapshot was requested or available.";
      if (requestedAsset) {
        try {
          const series = await fetchMarketSeries(requestedAsset, latest.toLowerCase().includes("1h") || latest.toLowerCase().includes("hour") ? "1h" : "15min");
          marketText = JSON.stringify({ symbol: series.symbol, close: series.close, trend: series.trend, interval: series.interval, fetchedAt: series.fetchedAt, marketContext: series.marketContext });
        } catch (error) { marketText = `Live snapshot unavailable for ${requestedAsset}: ${error instanceof Error ? error.message : "provider error"}`; }
      }
      const assetPerformance = summarizeChatSignals(signals).map((item) => `${item.asset}: ${item.generated} generated, ${item.resolved} resolved, ${item.wins} TP hits, ${item.winRate == null ? "—" : `${item.winRate}%`} win rate`).join("; ") || "No signals recorded in the last 24 hours.";
      const analyticsContext = buildWhiteAiAnalyticsContext({ winningRate, bestTime, bestDays, locatorOutcomes, sourceStats });
      const compactSignals = recentSignalRecords.slice(0, 20).map(({ id, asset, timeframe, direction, entry, stopLoss, takeProfit, riskReward, confidence, confluenceScore, rationale, status, outcomeNote, openedAt, closedAt, telegramDelivery }) => ({ id, asset, timeframe, direction, entry, stopLoss, takeProfit, riskReward, confidence, confluenceScore, rationale, status, outcomeNote, openedAt, closedAt, telegramDelivery: telegramDelivery ? { status: telegramDelivery.status, telegramMessageId: telegramDelivery.telegramMessageId, deliveredAt: telegramDelivery.deliveredAt, error: telegramDelivery.error } : null }));
      const compactLocatorStates = locatorStates.slice(0, 20).map(({ asset, timeframe, status, snapshotCount, lastSnapshotAt, lastDirection, lastConfidence, lastConfluence, lastEmittedAt }) => ({ asset, timeframe, status, snapshotCount, lastSnapshotAt, lastDirection, lastConfidence, lastConfluence, lastEmittedAt }));
      const compactRecentDecisions = recentDecisions.slice(0, 20).map(({ id, asset, timeframe, verdict, confidence, confluenceScore, generatedDirection, generatedEntry, generatedStopLoss, generatedTakeProfit, decisionReason, createdAt }) => ({ id, asset, timeframe, verdict, confidence, confluenceScore, generatedDirection, generatedEntry, generatedStopLoss, generatedTakeProfit, decisionReason, createdAt }));
      const asksForZoneEvidence = /\b(zone|supply|demand|support|resistance|level)\b/i.test(latest);
      const asksForSignalExplanation = /\b(stop\s*loss|take\s*profit|risk(?:-to-)?reward|entry|trade\s*signal|signal)\b/i.test(latest);
      const zoneContext = requestedAsset ? buildWhiteAiZoneContext(locatorStates, requestedAsset, requestedTimeframe, zoneHistory) : null;
      const signalContext = requestedAsset && asksForSignalExplanation ? buildWhiteAiSignalContext(recentSignalRecords, requestedAsset) : null;
      const isTradeIdea = isCompleteTradeIdea(latest);
      const system = [
        "You are White AI, Trading Guard AI's interactive app-explanation and trading-education assistant. Have a natural, useful conversation about this app's v5 workflow, scanner health, zones, hierarchy judgments, Entry Locator decisions, paper-trading records, market structure, risk, and the user's ingested forex document. Explain why the app sends or withholds signals using supplied evidence. Never invent live prices, zone positions, scanner cycles, or performance. Distinguish clearly between live market observations, persisted app records, and general educational explanations. The app's v5 signal workflow is authoritative: 4H bias, 1H context only, independent 15M/5M execution, structural target/stop geometry, 60% confidence, 45% confluence, Entry Locator final guard, strict asset/timeframe locks, Telegram delivery, and paper-only UNVALIDATED safeguards. Chat must never place, alter, release, or approve an automatic v5 trade signal. Every response must state or preserve that this is analysis only, paper trading only, and UNVALIDATED; never promise accuracy or present personalized financial advice. If a requested fact is unavailable, say so plainly.",
        "Cherry AI is an independent trade-review assistant. It may issue a trade-review verdict only when the user's message contains a complete trade idea with BUY or SELL plus at least one explicit price field such as Entry, Stop Loss, or Take Profit. For zone, education, scanner, or other informational questions without a complete trade idea, never default to BUY, SELL, TRADE APPROVED, or any market verdict; answer with grounded evidence when available or ask for the complete setup to review.",
        "Answer questions such as which asset appears more predictable from the available sample, the current paper context for gold, recent wins, the best-performing timeframe, the lowest-performing asset, and which asset has the least stable evidence. Use only resolved samples for win-rate claims, state sample sizes, and say when evidence is insufficient. Conversation memory is advisory context only and must never become a v5 rule.",
        `Relevant strategy rules for this question:\n${rulesText || "No matching rule excerpt was found."}\n\nBounded stored forex-document knowledge:\n${documentText || "No stored forex document is available."}\n\nPaper outcomes in last 24 hours:\n${assetPerformance}\n\nPersistent White AI conversation memory (advisory, not v5 rules):\n${memories.map((memory) => `[${memory.memoryType}] ${memory.content}`).join("\\n") || "No conversation memory has been saved yet."}\n\nBounded full outcome analytics from the app:\n${compactWhiteAiJson(analyticsContext, 12000)}\n\nRecent signal records with delivery and outcome fields:\n${compactWhiteAiJson(compactSignals, 10000)}\n\nStrategy judgment totals:\n${compactWhiteAiJson(judgment, 6000)}\n\nScanner freshness and cadence:\n${compactWhiteAiJson({ latestSuccessfulAt: cadence.latestSuccessfulAt, latestSuccessfulSource: cadence.latestSuccessfulSource, completedCycles: cadence.completedCycles, failedCycles: cadence.failedCycles, expectedIntervalMinutes: cadence.expectedIntervalMinutes })}\n\nV5 production smoke:\n${compactWhiteAiJson(smoke, 6000)}\n\nCurrent Entry Locator states:\n${compactWhiteAiJson(compactLocatorStates, 8000)}\n\nRecent v5 decision ledger:\n${compactWhiteAiJson(compactRecentDecisions, 10000)}\n\nRequested live market context:\n${marketText}\n\nRequested persisted v5 zone evidence:\n${zoneContext ? compactWhiteAiJson(zoneContext, 5000) : "No specific asset/timeframe zone request detected."}\n\nRequested persisted v5 signal explanation evidence:\n${signalContext ? compactWhiteAiJson(signalContext, 6000) : "No specific signal explanation request detected."}`
      ].join("\n\n");
      let content: string;
      if (input.channel === "CHERRY" && !isTradeIdea) {
        content = asksForZoneEvidence && zoneContext
          ? formatWhiteAiZoneFallback(zoneContext)
          : "Cherry AI is reserved for independent review of a complete trade idea. Please include BUY or SELL and the entry, stop-loss, or take-profit levels you want reviewed. No trade verdict or signal was created. This is analysis only — paper trading only — UNVALIDATED.";
      } else if (zoneContext && shouldUseDeterministicZoneFallback(input.channel, asksForZoneEvidence, zoneContext)) {
        content = formatWhiteAiZoneFallback(zoneContext);
      } else try {
        const response = await invokeLLM({ model: "gpt-5-mini", messages: [{ role: "system", content: system }, ...chatMessages], maxTokens: 1400 });
        const choice = response?.choices?.[0];
        if (!choice?.message) throw new Error("LLM response missing readable message");
        const normalizedContent = normalizeChatResponseContent(choice.message.content);
        if (normalizedContent.startsWith("The assistant returned no readable text")) throw new Error("LLM response missing readable text");
        content = normalizedContent;
      } catch (error) {
        console.warn(`[${input.channel === "WHITE" ? "White AI" : "Cherry AI"}] LLM request failed`, error instanceof Error ? error.message : String(error ?? "unknown error"));
        content = input.channel === "WHITE" && asksForZoneEvidence && zoneContext ? formatWhiteAiZoneFallback(zoneContext) : input.channel === "WHITE" && asksForSignalExplanation && signalContext ? formatWhiteAiSignalFallback(signalContext) : formatChatServiceError(error, input.channel === "WHITE" ? "White AI" : "Cherry AI");
      }
      await db.insert(auditMessages).values({ userId: ctx.user.id, channel: input.channel, role: "assistant", content });
      return { role: "assistant" as const, content, verdict: null, confidence: null, telegramDelivered: false };
    }),
  }),
  signals: router({
    list: protectedProcedure.query(({ ctx }) => listGeneratedSignals(ctx.user.id)),
    audits: protectedProcedure.query(({ ctx }) => listAuditTrades(ctx.user.id)),
    deliverySummary: protectedProcedure.query(({ ctx }) => getSignalDeliverySummary(ctx.user.id)),
    adjustments: protectedProcedure.query(({ ctx }) => listPaperTradeAdjustments(ctx.user.id)),
    upgradeChains: protectedProcedure.query(({ ctx }) => listPaperTradeUpgradeChains(ctx.user.id)),
    upgradeSummary: protectedProcedure.query(({ ctx }) => getPaperTradeUpgradeSummary(ctx.user.id)),
  }),
  scanner: router({
    status: protectedProcedure.query(({ ctx }) => getSettings(ctx.user.id)),
    marketPulse: protectedProcedure.query(({ ctx }) => getLiveMarketPulse(ctx.user.id)),
    decisions: protectedProcedure.input(z.object({ asset: z.string().optional(), timeframe: z.enum(["15MIN", "5MIN", "1H"]).optional(), verdict: z.enum(["APPROVED", "DENIED", "SKIPPED", "UNAVAILABLE"]).optional() }).optional()).query(({ ctx, input }) => listStrategyDecisionsForDashboard(ctx.user.id, input ?? {})),
    export: protectedProcedure.input(z.object({ format: z.enum(["csv", "json"]), asset: z.string().optional(), timeframe: z.enum(["15MIN", "5MIN", "1H"]).optional(), verdict: z.enum(["APPROVED", "DENIED", "SKIPPED", "UNAVAILABLE"]).optional() })).query(async ({ ctx, input }) => {
      const rows = await listStrategyDecisions(ctx.user.id, { asset: input.asset, timeframe: input.timeframe, verdict: input.verdict });
      return { format: input.format, filename: `strategy-decisions-${new Date().toISOString().slice(0, 10)}.${input.format}`, content: input.format === "csv" ? serializeDecisionLedgerCsv(rows) : serializeDecisionLedgerJson(rows) };
    }),
    summary: protectedProcedure.query(({ ctx }) => getStrategyDecisionSummary(ctx.user.id)),
    health: protectedProcedure.query(({ ctx }) => getStrategyEngineHealth(ctx.user.id)),
    cadence: protectedProcedure.query(({ ctx }) => getScannerCadenceDiagnostics(ctx.user.id)),
    v5Smoke: protectedProcedure.input(z.object({ lookbackMinutes: z.number().int().min(5).max(180).optional() }).optional()).query(({ ctx, input }) => getV5HierarchySmokeStatus(ctx.user.id, input?.lookbackMinutes ?? 30)),
    zoneHistory: protectedProcedure.input(z.object({ asset: z.string().optional(), timeframe: z.enum(["4H", "1H", "15MIN", "5MIN"]).optional() }).optional()).query(({ ctx, input }) => listV5ZoneHistory(ctx.user.id, input?.asset, input?.timeframe)),
    openCurrentSignals: protectedProcedure.query(({ ctx }) => listOpenCurrentV5Signals(ctx.user.id)),
    callbackStatus: protectedProcedure.query(async ({ ctx }) => {
      const settings = await getSettings(ctx.user.id);
      const session = parseCookie(ctx.req.headers.cookie ?? "")[COOKIE_NAME] ?? "";
      let registryAvailable = false;
      let schedulerJob = null;
      let taskUid = settings.scheduleCronTaskUid;
      try {
        const ownerJobs = await listHeartbeatJobs("", { pageSize: 100 });
        const selected = selectScannerSchedulerJob(taskUid, ownerJobs.jobs);
        taskUid = selected.taskUid;
        schedulerJob = selected.job;
        registryAvailable = true;
      } catch {
        try {
          const userJobs = await listHeartbeatJobs(session, { pageSize: 100 });
          const selected = selectScannerSchedulerJob(taskUid, userJobs.jobs);
          taskUid = selected.taskUid;
          schedulerJob = selected.job;
          registryAvailable = true;
        } catch {
          registryAvailable = false;
        }
      }
      if (registryAvailable && taskUid && taskUid !== settings.scheduleCronTaskUid) {
        const db = await getDb();
        if (db) await db.update(appSettings).set({ scheduleCronTaskUid: taskUid }).where(eq(appSettings.userId, ctx.user.id));
      }
      const status = buildCallbackStatus({ scannerEnabled: settings.scannerEnabled, scheduleCronTaskUid: taskUid, strategyEngineStatus: settings.strategyEngineStatus, strategyEngineLastRunAt: settings.strategyEngineLastRunAt, schedulerJob, schedulerRegistryAvailable: registryAvailable });
      const recentRuns = taskUid ? await listRecentScannerRuns(taskUid, 5) : [];
      const latestRun = recentRuns[0] ?? null;
      const stale = Boolean(schedulerJob?.isEnable && schedulerJob.nextExecutionAt && new Date(schedulerJob.nextExecutionAt).getTime() < Date.now() - 120000);
      return { ...status, recentRuns, latestRun, staleCycle: stale };
    }),
    cooldownHistory: protectedProcedure.query(({ ctx }) => listCooldownChanges(ctx.user.id)),
    updateCooldown: protectedProcedure.input(z.object({ minutes: z.number().int().min(0).max(1440) })).mutation(async ({ ctx, input }) => {
      const current = await getSettings(ctx.user.id);
      const previousMinutes = current.setupCooldownMinutes ?? 30;
      if (previousMinutes !== input.minutes) {
        await updateSetupCooldown(ctx.user.id, input.minutes);
        await recordCooldownChange({ userId: ctx.user.id, previousMinutes, newMinutes: input.minutes });
      }
      return { minutes: input.minutes };
    }),
    toggle: protectedProcedure.input(z.object({ enabled: z.boolean() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      await db.insert(appSettings).values({ userId: ctx.user.id, scannerEnabled: input.enabled }).onDuplicateKeyUpdate({ set: { scannerEnabled: input.enabled } });
      return { enabled: input.enabled };
    }),
    activate: protectedProcedure.mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const session = parseCookie(ctx.req.headers.cookie ?? "")[COOKIE_NAME] ?? "";
      const job = await createHeartbeatJob({ name: `trading-guard-scanner-${ctx.user.id}`, cron: "0 */5 * * * *", path: "/api/scheduled/trading-guard-scanner", description: "TradingGuardAI five-minute market scanner and outcome tracker with multi-key Twelve Data failover" }, session);
      await db.insert(appSettings).values({ userId: ctx.user.id, scannerEnabled: true, scheduleCronTaskUid: job.taskUid }).onDuplicateKeyUpdate({ set: { scannerEnabled: true, scheduleCronTaskUid: job.taskUid } });
      return job;
    }),
  }),
});

export type AppRouter = typeof appRouter;
