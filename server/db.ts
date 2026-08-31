import { and, asc, count, desc, eq, gte, inArray, isNull, lt, not, notInArray, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { appSettings, auditMessages, auditTrades, cooldownChangeLog, entryLocatorStates, generatedSignals, InsertUser, ownerAlertLedger, scannerRunLedger, strategyDecisionLedger, strategyRules, strategyIntelligenceComponents, strategyIntelligenceVersions, strategyLessons, telegramDeliveries, paperTradeAdjustments, users, v5ZoneHistory, whiteAiMemories } from "../drizzle/schema";
import { ENV } from './_core/env';
import { filterStrategyDecisions, type DecisionFilters } from "./decision-ledger";
import { isStaleScannerRun, summarizeScannerCadence } from "./scheduler-status";

let _db: ReturnType<typeof drizzle> | null = null;

// Dashboard reads must remain bounded on Render's 512 MB free instance. Full
// market snapshots and evidence are retained in the database; only the views
// that need them should request them, and all live dashboard collections have a
// deliberate upper bound.
export const SCANNER_DASHBOARD_LIMIT = 24;
export const SCANNER_SMOKE_LIMIT = 48;
export const SCANNER_DELIVERY_LIMIT = 100;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function createIntelligenceVersion(input: typeof strategyIntelligenceVersions.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.insert(strategyIntelligenceVersions).values(input);
  return { id: Number(result[0].insertId), ...input };
}

export async function listIntelligenceVersions(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(strategyIntelligenceVersions).where(eq(strategyIntelligenceVersions.userId, userId)).orderBy(desc(strategyIntelligenceVersions.createdAt));
}

export async function getActiveIntelligenceVersion(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(strategyIntelligenceVersions).where(and(eq(strategyIntelligenceVersions.userId, userId), eq(strategyIntelligenceVersions.status, "ACTIVE"))).orderBy(desc(strategyIntelligenceVersions.createdAt)).limit(1);
  return rows[0];
}

export async function activateIntelligenceVersion(userId: number, versionId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.update(strategyIntelligenceVersions).set({ status: "RETIRED" }).where(and(eq(strategyIntelligenceVersions.userId, userId), eq(strategyIntelligenceVersions.status, "ACTIVE")));
  await db.update(strategyIntelligenceVersions).set({ status: "ACTIVE", activatedAt: new Date() }).where(and(eq(strategyIntelligenceVersions.userId, userId), eq(strategyIntelligenceVersions.id, versionId)));
}

export async function createIntelligenceComponent(input: typeof strategyIntelligenceComponents.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.insert(strategyIntelligenceComponents).values(input);
  return { id: Number(result[0].insertId), ...input };
}

export async function listIntelligenceComponents(userId: number, versionId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(strategyIntelligenceComponents).where(and(eq(strategyIntelligenceComponents.userId, userId), eq(strategyIntelligenceComponents.versionId, versionId), eq(strategyIntelligenceComponents.enabled, true)));
}

export async function createStrategyLesson(input: typeof strategyLessons.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.insert(strategyLessons).values(input);
  return { id: Number(result[0].insertId), ...input };
}

export async function listStrategyLessons(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(strategyLessons).where(eq(strategyLessons.userId, userId)).orderBy(desc(strategyLessons.createdAt)).limit(100);
}

export async function listAcceptedStrategyLessons(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(strategyLessons).where(and(eq(strategyLessons.userId, userId), eq(strategyLessons.status, "ACCEPTED"))).orderBy(desc(strategyLessons.validatedAt));
}

export async function updateStrategyLessonStatus(userId: number, lessonId: number, status: "PROPOSED" | "VALIDATING" | "ACCEPTED" | "REJECTED", sourceVersionId?: number | null) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.update(strategyLessons).set({ status, sourceVersionId: sourceVersionId ?? undefined, validatedAt: status === "ACCEPTED" ? new Date() : null }).where(and(eq(strategyLessons.userId, userId), eq(strategyLessons.id, lessonId)));
}

export async function updateStrategyLessonPatternStatus(userId: number, outcome: "WIN" | "LOSS", patternKey: string, status: "ACCEPTED" | "REJECTED", sourceVersionId?: number | null) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const lessons = await db.select({ id: strategyLessons.id, lessonJson: strategyLessons.lessonJson }).from(strategyLessons).where(and(eq(strategyLessons.userId, userId), eq(strategyLessons.outcome, outcome), eq(strategyLessons.status, "PROPOSED")));
  const matchingIds = lessons.filter((lesson) => {
    try { return (JSON.parse(lesson.lessonJson) as { patternKey?: unknown }).patternKey === patternKey; } catch { return false; }
  }).map((lesson) => lesson.id);
  for (const lessonId of matchingIds) await updateStrategyLessonStatus(userId, lessonId, status, sourceVersionId);
  return { updated: matchingIds.length, lessonIds: matchingIds };
}

export function isUsableStrategyRule(rule: { title?: string | null; content?: string | null }) {
  const title = String(rule.title ?? "").trim();
  const content = String(rule.content ?? "").trim();
  if (!title || !content) return false;
  if (content.toLowerCase() === "undefined") return false;
  if (/guardrail:\s*undefined\b/i.test(content)) return false;
  return true;
}

export async function listStrategyRules(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(strategyRules).where(eq(strategyRules.userId, userId)).orderBy(desc(strategyRules.createdAt));
  return rows.filter(isUsableStrategyRule);
}

export function toStrategyRuleSummary<T extends { content: string }>(rule: T, previewChars = 720) {
  const preview = rule.content.length > previewChars ? `${rule.content.slice(0, previewChars)}…` : rule.content;
  return { ...rule, content: preview, contentLength: rule.content.length };
}

export async function listStrategyRuleSummaries(userId: number, previewChars = 720) {
  const rules = await listStrategyRules(userId);
  return rules.map((rule) => toStrategyRuleSummary(rule, previewChars));
}

export async function createStrategyRule(input: typeof strategyRules.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.insert(strategyRules).values(input);
  return { id: Number(result[0].insertId), ...input };
}

export async function listAuditMessages(userId: number, channel: "WHITE" | "CHERRY" = "WHITE") {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(auditMessages).where(and(eq(auditMessages.userId, userId), eq(auditMessages.channel, channel))).orderBy(desc(auditMessages.createdAt)).limit(100);
}

export async function listWhiteAiMemories(userId: number, limit = 40) {
  const db = await getDb();
  if (!db) return [];
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  return db.select({ id: whiteAiMemories.id, memoryType: whiteAiMemories.memoryType, content: whiteAiMemories.content, sourceMessageId: whiteAiMemories.sourceMessageId, createdAt: whiteAiMemories.createdAt })
    .from(whiteAiMemories)
    .where(eq(whiteAiMemories.userId, userId))
    .orderBy(desc(whiteAiMemories.createdAt))
    .limit(safeLimit);
}

export function normalizeWhiteAiMemory(content: string) {
  return content.replace(/\s+/g, " ").trim().slice(0, 1200);
}

export async function rememberWhiteAiConversation(userId: number, content: string, sourceMessageId?: number | null) {
  const db = await getDb();
  if (!db) return null;
  const normalized = normalizeWhiteAiMemory(content);
  if (!normalized) return null;
  const existing = await db.select({ id: whiteAiMemories.id }).from(whiteAiMemories)
    .where(and(eq(whiteAiMemories.userId, userId), eq(whiteAiMemories.content, normalized)))
    .limit(1);
  if (existing[0]) return existing[0];
  const result = await db.insert(whiteAiMemories).values({ userId, memoryType: "CONVERSATION", content: normalized, sourceMessageId: sourceMessageId ?? null });
  return { id: Number(result[0].insertId), content: normalized };
}

export function attachTelegramDelivery<T extends { id: number }, D extends { kind: string; signalId?: number | null; auditTradeId?: number | null }>(rows: T[], deliveries: D[], kind: "SIGNAL" | "AUDIT", key: "signalId" | "auditTradeId") {
  return rows.map((row) => ({ ...row, telegramDelivery: deliveries.find((delivery) => delivery.kind === kind && delivery[key] === row.id) ?? null }));
}

export async function listGeneratedSignals(userId: number, asset?: string | null) {
  const db = await getDb();
  if (!db) return [];
  const predicate = asset ? and(eq(generatedSignals.userId, userId), eq(generatedSignals.asset, asset)) : eq(generatedSignals.userId, userId);
  const signals = await db.select().from(generatedSignals).where(predicate).orderBy(desc(generatedSignals.openedAt)).limit(50);
  const deliveries = await db.select().from(telegramDeliveries).where(eq(telegramDeliveries.userId, userId));
  return attachTelegramDelivery(signals, deliveries, "SIGNAL", "signalId");
}

export async function listGeneratedSignalsSince(userId: number, since: Date, limit = 250) {
  const db = await getDb();
  if (!db) return [];
  return db.select({ id: generatedSignals.id, asset: generatedSignals.asset, timeframe: generatedSignals.timeframe, direction: generatedSignals.direction, status: generatedSignals.status, confidence: generatedSignals.confidence, intelligenceVersion: generatedSignals.intelligenceVersion, openedAt: generatedSignals.openedAt, closedAt: generatedSignals.closedAt }).from(generatedSignals).where(and(eq(generatedSignals.userId, userId), gte(generatedSignals.openedAt, since))).orderBy(desc(generatedSignals.openedAt)).limit(limit);
}

export async function listPaperTradeUpgradeChains(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const signals = await db.select().from(generatedSignals).where(and(eq(generatedSignals.userId, userId), eq(generatedSignals.intelligenceVersion, "forex-trading-combined-document-v5"), eq(generatedSignals.generationMode, ENTRY_LOCATOR_V5_GENERATION_MODE))).orderBy(desc(generatedSignals.openedAt)).limit(250);
  const adjustments = await db.select().from(paperTradeAdjustments).where(and(eq(paperTradeAdjustments.userId, userId), eq(paperTradeAdjustments.action, "UPGRADE_PAPER_SETUP"))).orderBy(desc(paperTradeAdjustments.createdAt)).limit(250);
  const deliveries = await db.select().from(telegramDeliveries).where(eq(telegramDeliveries.userId, userId));
  const byId = new Map(signals.map((signal) => [signal.id, signal]));
  return adjustments.map((adjustment) => ({
    adjustment,
    original: byId.get(adjustment.signalId) ?? null,
    replacement: adjustment.replacementSignalId ? byId.get(adjustment.replacementSignalId) ?? null : null,
    originalDelivery: deliveries.find((delivery) => delivery.kind === "SIGNAL" && delivery.signalId === adjustment.signalId) ?? null,
    upgradeDelivery: deliveries.find((delivery) => delivery.kind === "ADJUSTMENT" && delivery.signalId === adjustment.signalId && delivery.dedupeKey === adjustment.dedupeKey) ?? null,
    replacementDelivery: adjustment.replacementSignalId ? deliveries.find((delivery) => delivery.kind === "SIGNAL" && delivery.signalId === adjustment.replacementSignalId) ?? null : null,
  }));
}

export async function getPaperTradeUpgradeSummary(userId: number) {
  const db = await getDb();
  if (!db) return { upgradeCount: 0, sourceTheses: 0, replacementTheses: 0, frequencyPercent: null as number | null };
  const [signals, adjustments] = await Promise.all([
    db.select({ id: generatedSignals.id }).from(generatedSignals).where(and(eq(generatedSignals.userId, userId), eq(generatedSignals.intelligenceVersion, "forex-trading-combined-document-v5"), eq(generatedSignals.generationMode, ENTRY_LOCATOR_V5_GENERATION_MODE))),
    db.select({ signalId: paperTradeAdjustments.signalId, replacementSignalId: paperTradeAdjustments.replacementSignalId }).from(paperTradeAdjustments).where(and(eq(paperTradeAdjustments.userId, userId), eq(paperTradeAdjustments.action, "UPGRADE_PAPER_SETUP"))),
  ]);
  const replacementIds = new Set(adjustments.map((adjustment) => adjustment.replacementSignalId).filter((id): id is number => id != null));
  const sourceTheses = signals.filter((signal) => !replacementIds.has(signal.id)).length;
  const upgradeCount = adjustments.length;
  return { upgradeCount, sourceTheses, replacementTheses: replacementIds.size, frequencyPercent: sourceTheses ? Math.round((upgradeCount / sourceTheses) * 100) : null };
}

export const ENTRY_LOCATOR_V5_GENERATION_MODE = "ENTRY_LOCATOR_V5" as const;
export async function hasOpenGeneratedSignal(userId: number, asset: string, timeframe: string, intelligenceVersion?: string, generationMode?: string) {
  const db = await getDb();
  if (!db) return false;
  const filters = [eq(generatedSignals.userId, userId), eq(generatedSignals.asset, asset), eq(generatedSignals.timeframe, timeframe), eq(generatedSignals.status, "PENDING")];
  if (intelligenceVersion) filters.push(eq(generatedSignals.intelligenceVersion, intelligenceVersion));
  if (generationMode) filters.push(eq(generatedSignals.generationMode, generationMode));
  const rows = await db.select({ id: generatedSignals.id }).from(generatedSignals).where(and(...filters)).limit(1);
  return rows.length > 0;
}

export async function getEntryLocatorState(userId: number, asset: string, timeframe: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(entryLocatorStates).where(and(eq(entryLocatorStates.userId, userId), eq(entryLocatorStates.asset, asset), eq(entryLocatorStates.timeframe, timeframe))).limit(1);
  return rows[0];
}

export async function saveEntryLocatorState(input: { userId: number; asset: string; timeframe: string; status: "WAITING" | "READY" | "EMITTED"; snapshotCount: number; lastSnapshotAt?: Date | null; lastDirection?: "BUY" | "SELL" | null; lastConfidence?: string | null; lastConfluence?: string | null; evidenceJson?: string | null; conflictJson?: string | null; stateJson?: string | null; lastEmittedAt?: Date | null }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const existing = await getEntryLocatorState(input.userId, input.asset, input.timeframe);
  if (existing) {
    await db.update(entryLocatorStates).set({ status: input.status, snapshotCount: input.snapshotCount, lastSnapshotAt: input.lastSnapshotAt ?? null, lastDirection: input.lastDirection ?? null, lastConfidence: input.lastConfidence ?? null, lastConfluence: input.lastConfluence ?? null, evidenceJson: input.evidenceJson ?? null, conflictJson: input.conflictJson ?? null, stateJson: input.stateJson ?? null, lastEmittedAt: input.lastEmittedAt ?? existing.lastEmittedAt ?? null }).where(eq(entryLocatorStates.id, existing.id));
    return { ...existing, ...input };
  }
  const result = await db.insert(entryLocatorStates).values({ ...input, lastSnapshotAt: input.lastSnapshotAt ?? null, lastDirection: input.lastDirection ?? null, lastConfidence: input.lastConfidence ?? null, lastConfluence: input.lastConfluence ?? null, evidenceJson: input.evidenceJson ?? null, conflictJson: input.conflictJson ?? null, stateJson: input.stateJson ?? null, lastEmittedAt: input.lastEmittedAt ?? null });
  return { id: Number(result[0].insertId), ...input };
}

export async function upsertV5ZoneHistory(input: typeof v5ZoneHistory.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.insert(v5ZoneHistory).values(input).onDuplicateKeyUpdate({ set: {
    zoneKind: input.zoneKind,
    lower: input.lower,
    upper: input.upper,
    reactions: input.reactions,
    displacement: input.displacement,
    fresh: input.fresh,
    weakFor: input.weakFor,
    lifecycle: input.lifecycle,
    observationCount: input.observationCount,
    retestCount: input.retestCount,
    lastSeenAt: input.lastSeenAt,
    lastCandleAt: input.lastCandleAt ?? null,
    lastRetestedAt: input.lastRetestedAt ?? null,
    evidenceJson: input.evidenceJson,
  } });
}

export async function listV5ZoneHistory(userId: number, asset?: string, timeframe?: string) {
  const db = await getDb();
  if (!db) return [];
  const filters = [eq(v5ZoneHistory.userId, userId)];
  if (asset) filters.push(eq(v5ZoneHistory.asset, asset));
  if (timeframe) filters.push(eq(v5ZoneHistory.timeframe, timeframe));
  return db.select().from(v5ZoneHistory).where(and(...filters)).orderBy(desc(v5ZoneHistory.lastSeenAt)).limit(500);
}

export async function listEntryLocatorStates(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const [states, signals, deliveries] = await Promise.all([
    db.select().from(entryLocatorStates).where(eq(entryLocatorStates.userId, userId)).orderBy(desc(entryLocatorStates.updatedAt)).limit(SCANNER_DASHBOARD_LIMIT),
    db.select().from(generatedSignals).where(and(eq(generatedSignals.userId, userId), eq(generatedSignals.intelligenceVersion, "forex-trading-combined-document-v5"), eq(generatedSignals.status, "PENDING"))).orderBy(desc(generatedSignals.openedAt)).limit(SCANNER_DASHBOARD_LIMIT),
    db.select().from(telegramDeliveries).where(eq(telegramDeliveries.userId, userId)).orderBy(desc(telegramDeliveries.createdAt)).limit(SCANNER_DELIVERY_LIMIT),
  ]);
  return states.map((state) => {
    const matchingSignal = signals.find((signal) => signal.asset === state.asset && signal.timeframe === state.timeframe) ?? null;
    const telegramDelivery = matchingSignal ? deliveries.find((delivery) => delivery.kind === "SIGNAL" && delivery.signalId === matchingSignal.id) ?? null : null;
    return {
      ...state,
      matchingSignal: matchingSignal ? { id: matchingSignal.id, direction: matchingSignal.direction, status: matchingSignal.status, openedAt: matchingSignal.openedAt, riskReward: matchingSignal.riskReward } : null,
      telegramDelivery: telegramDelivery ? { id: telegramDelivery.id, status: telegramDelivery.status, createdAt: telegramDelivery.createdAt, deliveredAt: telegramDelivery.deliveredAt, error: telegramDelivery.error } : null,
      orphanedEmission: state.status === "EMITTED" && !matchingSignal,
    };
  });
}


export async function listAuditTrades(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const audits = await db.select().from(auditTrades).where(eq(auditTrades.userId, userId)).orderBy(desc(auditTrades.createdAt)).limit(50);
  const deliveries = await db.select().from(telegramDeliveries).where(eq(telegramDeliveries.userId, userId));
  return attachTelegramDelivery(audits, deliveries, "AUDIT", "auditTradeId");
}

export async function claimTelegramDelivery(input: { userId: number; signalId?: number; kind: "SIGNAL" | "AUDIT" | "OUTCOME" | "SUMMARY" | "REASON" | "ADJUSTMENT"; dedupeKey: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.insert(telegramDeliveries).values({ userId: input.userId, signalId: input.signalId ?? null, kind: input.kind, status: "FAILED", dedupeKey: input.dedupeKey, retryCount: 0, lastRetryAt: new Date() }).onDuplicateKeyUpdate({ set: { dedupeKey: sql`${telegramDeliveries.dedupeKey}` } });
  return Number((result as any)[0]?.affectedRows ?? 0) === 1;
}

export async function recordTelegramDelivery(input: { userId: number; signalId?: number; auditTradeId?: number; kind: "SIGNAL" | "AUDIT" | "OUTCOME" | "SUMMARY" | "REASON" | "ADJUSTMENT"; status: "DELIVERED" | "FAILED"; telegramMessageId?: string; dedupeKey: string; error?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const now = new Date();
  const deliveredAt = input.status === "DELIVERED" ? now : null;
  const isOutcome = input.kind === "OUTCOME";
  await db.insert(telegramDeliveries).values({ ...input, deliveredAt, retryCount: isOutcome ? 1 : 0, lastRetryAt: isOutcome ? now : null }).onDuplicateKeyUpdate({     set: { userId: input.userId, signalId: input.signalId ?? null, auditTradeId: input.auditTradeId ?? null, kind: input.kind, status: input.status, telegramMessageId: input.telegramMessageId ?? null, error: input.error ?? null, deliveredAt, retryCount: isOutcome ? sql`${telegramDeliveries.retryCount} + 1` : sql`${telegramDeliveries.retryCount}`, lastRetryAt: isOutcome ? now : sql`${telegramDeliveries.lastRetryAt}` } });
}

export async function listPaperTradeAdjustments(userId: number, limit = 100) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(paperTradeAdjustments).where(eq(paperTradeAdjustments.userId, userId)).orderBy(desc(paperTradeAdjustments.createdAt)).limit(limit);
  const deliveries = await db.select().from(telegramDeliveries).where(eq(telegramDeliveries.userId, userId));
  return rows.map((row) => ({ ...row, telegramDelivery: deliveries.find((delivery) => delivery.kind === "ADJUSTMENT" && delivery.dedupeKey === row.dedupeKey) ?? null }));
}

export async function listOpenCurrentV5Signals(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(generatedSignals).where(and(eq(generatedSignals.userId, userId), eq(generatedSignals.status, "PENDING"), eq(generatedSignals.intelligenceVersion, "forex-trading-combined-document-v5"), eq(generatedSignals.generationMode, ENTRY_LOCATOR_V5_GENERATION_MODE))).orderBy(desc(generatedSignals.openedAt));
}

export async function hasExactGeneratedSignal(input: { userId: number; asset: string; timeframe: string; direction: "BUY" | "SELL"; entry: string | number; stopLoss: string | number; takeProfit: string | number; riskReward: string | number; confidence: string | number; confluenceScore: string | number; intelligenceVersion: string; generationMode: string }) {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select({ id: generatedSignals.id }).from(generatedSignals).where(and(
    eq(generatedSignals.userId, input.userId),
    eq(generatedSignals.asset, input.asset),
    eq(generatedSignals.timeframe, input.timeframe),
    eq(generatedSignals.direction, input.direction),
    eq(generatedSignals.entry, String(input.entry)),
    eq(generatedSignals.stopLoss, String(input.stopLoss)),
    eq(generatedSignals.takeProfit, String(input.takeProfit)),
    eq(generatedSignals.riskReward, String(input.riskReward)),
    eq(generatedSignals.confidence, String(input.confidence)),
    eq(generatedSignals.confluenceScore, String(input.confluenceScore)),
    eq(generatedSignals.intelligenceVersion, input.intelligenceVersion),
    eq(generatedSignals.generationMode, input.generationMode),
  )).limit(1);
  return rows.length > 0;
}

export async function getReplacementParentSignal(userId: number, replacementSignalId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select({ parent: generatedSignals }).from(paperTradeAdjustments)
    .innerJoin(generatedSignals, eq(paperTradeAdjustments.signalId, generatedSignals.id))
    .where(and(eq(paperTradeAdjustments.userId, userId), eq(paperTradeAdjustments.replacementSignalId, replacementSignalId)))
    .orderBy(desc(paperTradeAdjustments.createdAt))
    .limit(1);
  return rows[0]?.parent;
}

export async function getReplacementRootSignal(userId: number, signalId: number) {
  let currentId = signalId;
  let parent = await getReplacementParentSignal(userId, currentId);
  let steps = 0;
  while (parent && steps < 8) {
    const next = await getReplacementParentSignal(userId, parent.id);
    if (!next) return parent;
    parent = next;
    steps += 1;
  }
  return parent;
}

export const OUTCOME_RETRY_WINDOW_MINUTES = 20;

export function isOutcomeDeliveryRetryable(createdAt: Date | string, now = new Date(), windowMinutes = OUTCOME_RETRY_WINDOW_MINUTES) {
  const created = createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
  const current = now.getTime();
  return Number.isFinite(created) && created >= current - windowMinutes * 60_000 && created <= current;
}

export async function listFailedOutcomeDeliveries(userId: number, limit = 2, now = new Date()) {
  const db = await getDb();
  if (!db) return [];
  const retrySince = new Date(now.getTime() - OUTCOME_RETRY_WINDOW_MINUTES * 60_000);
  return db.select({ delivery: telegramDeliveries, signal: generatedSignals })
    .from(telegramDeliveries)
    .innerJoin(generatedSignals, eq(telegramDeliveries.signalId, generatedSignals.id))
    .where(and(eq(telegramDeliveries.userId, userId), eq(telegramDeliveries.kind, "OUTCOME"), eq(telegramDeliveries.status, "FAILED"), gte(telegramDeliveries.createdAt, retrySince), inArray(generatedSignals.status, ["WIN", "LOSS"])))
    .orderBy(asc(telegramDeliveries.createdAt))
    .limit(limit);
}

export async function listResolvedSignalsMissingOutcomeDelivery(userId: number, limit = 2) {
  const db = await getDb();
  if (!db) return [];
  return db.select({ signal: generatedSignals })
    .from(generatedSignals)
    .leftJoin(telegramDeliveries, and(eq(telegramDeliveries.signalId, generatedSignals.id), eq(telegramDeliveries.kind, "OUTCOME")))
    .where(and(
      eq(generatedSignals.userId, userId),
      eq(generatedSignals.intelligenceVersion, "forex-trading-combined-document-v5"),
      inArray(generatedSignals.status, ["WIN", "LOSS"]),
      isNull(telegramDeliveries.id),
      or(isNull(generatedSignals.outcomeNote), not(sql`${generatedSignals.outcomeNote} like 'Manual outcome override confirmed by user:%'`)),
    ))
    .orderBy(desc(generatedSignals.closedAt))
    .limit(limit);
}

export async function hasPaperTradeAdjustment(dedupeKey: string) {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select({ id: paperTradeAdjustments.id }).from(paperTradeAdjustments).where(eq(paperTradeAdjustments.dedupeKey, dedupeKey)).limit(1);
  return rows.length > 0;
}

export async function createPaperTradeAdjustment(input: { userId: number; signalId: number; asset: string; timeframe: string; originalDirection: "BUY" | "SELL"; observedDirection: "BUY" | "SELL"; currentPrice: string; confidence: string; confluenceScore: string; action: "REVIEW_DIRECTION" | "TIGHTEN_STOP" | "EXIT_PAPER_SETUP" | "UPGRADE_PAPER_SETUP"; replacementSignalId?: number | null; reason: string; evidenceJson: string; dedupeKey: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.insert(paperTradeAdjustments).values({ ...input, replacementSignalId: input.replacementSignalId ?? null }).onDuplicateKeyUpdate({ set: { reason: input.reason, evidenceJson: input.evidenceJson, replacementSignalId: input.replacementSignalId ?? null } });
  return Number(result[0].insertId);
}

export async function supersedeGeneratedSignal(signalId: number, replacementSignalId: number, note: string) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.update(generatedSignals).set({ status: "SUPERSEDED", supersededBySignalId: replacementSignalId, outcomeNote: note, closedAt: new Date() }).where(and(eq(generatedSignals.id, signalId), eq(generatedSignals.status, "PENDING")));
}

export async function getTelegramDeliveryForSignal(userId: number, signalId: number, kind: "SIGNAL" | "OUTCOME" = "SIGNAL") {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(telegramDeliveries).where(and(eq(telegramDeliveries.userId, userId), eq(telegramDeliveries.signalId, signalId), eq(telegramDeliveries.kind, kind))).orderBy(desc(telegramDeliveries.createdAt)).limit(1);
  return rows[0];
}

export async function findSignalByTelegramMessageId(telegramMessageId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const deliveries = await db.select().from(telegramDeliveries).where(and(eq(telegramDeliveries.telegramMessageId, telegramMessageId), eq(telegramDeliveries.kind, "SIGNAL"), eq(telegramDeliveries.status, "DELIVERED"))).orderBy(desc(telegramDeliveries.createdAt)).limit(1);
  const delivery = deliveries[0];
  if (!delivery?.signalId) return undefined;
  const signals = await db.select().from(generatedSignals).where(and(eq(generatedSignals.id, delivery.signalId), eq(generatedSignals.userId, delivery.userId))).limit(1);
  const signal = signals[0];
  return signal ? { delivery, signal } : undefined;
}

export async function hasTelegramDelivery(dedupeKey: string) {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select({ status: telegramDeliveries.status }).from(telegramDeliveries).where(eq(telegramDeliveries.dedupeKey, dedupeKey)).limit(1);
  return rows[0]?.status === "DELIVERED";
}

export function summarizeTelegramDeliveryHealth(deliveries: Array<{ kind: string; status: string; error?: string | null; createdAt?: Date | string | null }>, now = new Date(), windowHours = 24) {
  const windowStart = now.getTime() - windowHours * 60 * 60 * 1000;
  const parseTime = (value: Date | string | null | undefined) => value instanceof Date ? value.getTime() : value ? new Date(value).getTime() : Number.NaN;
  const isRateLimit = (error: string | null | undefined) => /429|rate.?limit|too many requests/i.test(error ?? "");
  const recent = deliveries.filter((delivery) => {
    const createdAt = parseTime(delivery.createdAt);
    return Number.isFinite(createdAt) && createdAt >= windowStart;
  });
  const recentTelegram = recent;
  const recentFailed = recentTelegram.filter((delivery) => delivery.status === "FAILED");
  const recentDelivered = recentTelegram.filter((delivery) => delivery.status === "DELIVERED");
  const failed = deliveries.filter((delivery) => delivery.status === "FAILED");
  const historicalRateLimitFailures = failed.filter((delivery) => !recent.includes(delivery) && isRateLimit(delivery.error));
  const historicalOtherFailures = failed.filter((delivery) => !recent.includes(delivery) && !isRateLimit(delivery.error));
  const failureTimestamps = failed.map((delivery) => parseTime(delivery.createdAt)).filter(Number.isFinite);
  return {
    windowHours,
    recentAttempts: recentTelegram.length,
    recentDelivered: recentDelivered.length,
    recentFailed: recentFailed.length,
    recentFailureRate: recentTelegram.length ? Math.round((recentFailed.length / recentTelegram.length) * 100) : null,
    historicalRateLimitFailures: historicalRateLimitFailures.length,
    historicalOtherFailures: historicalOtherFailures.length,
    latestFailureAt: failureTimestamps.length ? new Date(Math.max(...failureTimestamps)) : null,
  };
}

export function summarizeDeliveryCounts(signals: Array<{ status: string }>, audits: Array<{ verdict: string }>, deliveries: Array<{ kind: string; status: string }>) {
  const count = (kind: "SIGNAL" | "AUDIT" | "OUTCOME" | "REASON" | "ADJUSTMENT", status?: "DELIVERED" | "FAILED") => deliveries.filter((delivery) => delivery.kind === kind && (!status || delivery.status === status)).length;
  return {
    generated: signals.length,
    pending: signals.filter((signal) => signal.status === "PENDING").length,
    wins: signals.filter((signal) => signal.status === "WIN").length,
    losses: signals.filter((signal) => signal.status === "LOSS").length,
    audits: audits.length,
    approvedAudits: audits.filter((audit) => audit.verdict === "APPROVED").length,
    signalAttempts: count("SIGNAL"), signalDelivered: count("SIGNAL", "DELIVERED"), signalFailed: count("SIGNAL", "FAILED"),
    auditAttempts: count("AUDIT"), auditDelivered: count("AUDIT", "DELIVERED"), auditFailed: count("AUDIT", "FAILED"),
    approvedAuditDelivered: deliveries.filter((delivery) => delivery.kind === "AUDIT" && delivery.status === "DELIVERED").length,
    approvedAuditFailed: deliveries.filter((delivery) => delivery.kind === "AUDIT" && delivery.status === "FAILED").length,
    outcomeAttempts: count("OUTCOME"), outcomeDelivered: count("OUTCOME", "DELIVERED"), outcomeFailed: count("OUTCOME", "FAILED"),
    reasonAttempts: count("REASON"), reasonDelivered: count("REASON", "DELIVERED"), reasonFailed: count("REASON", "FAILED"),
    adjustmentAttempts: count("ADJUSTMENT"), adjustmentDelivered: count("ADJUSTMENT", "DELIVERED"), adjustmentFailed: count("ADJUSTMENT", "FAILED"),
  };
}

export async function getSignalDeliverySummary(userId: number) {
  const db = await getDb();
  if (!db) return { ...summarizeDeliveryCounts([], [], []), deliveryHealth: summarizeTelegramDeliveryHealth([]), staleOutcomeFailures: [] };
  const signals = await db.select().from(generatedSignals).where(eq(generatedSignals.userId, userId));
  const audits = await db.select().from(auditTrades).where(eq(auditTrades.userId, userId));
  const deliveries = await db.select().from(telegramDeliveries).where(eq(telegramDeliveries.userId, userId));
  const staleSince = new Date(Date.now() - OUTCOME_RETRY_WINDOW_MINUTES * 60_000);
  const staleOutcomeFailures = deliveries.filter((delivery) => delivery.kind === "OUTCOME" && delivery.status === "FAILED" && delivery.createdAt < staleSince).slice(0, 25).map((delivery) => {
    const signal = signals.find((candidate) => candidate.id === delivery.signalId);
    return { deliveryId: delivery.id, signalId: delivery.signalId, asset: signal?.asset ?? "—", timeframe: signal?.timeframe ?? "—", status: signal?.status ?? "—", retryCount: delivery.retryCount ?? 0, error: delivery.error ?? "Unknown delivery failure", createdAt: delivery.createdAt };
  });
  return { ...summarizeDeliveryCounts(signals, audits, deliveries), deliveryHealth: summarizeTelegramDeliveryHealth(deliveries), staleOutcomeFailures };
}

export async function getSettings(userId: number) {
  const db = await getDb();
  if (!db) return { onboardingComplete: false, scannerEnabled: true, setupCooldownMinutes: 30, strategyEngineStatus: "NOT_RUN" as const, strategyEngineLastRunAt: null, strategyEngineLastError: null, strategyEngineTotalSnapshots: 0, strategyEngineCompleteResponses: 0, strategyEngineRetryCount: 0, strategyEngineUnavailableCycles: 0, scheduleCronTaskUid: null };
  const rows = await db.select().from(appSettings).where(eq(appSettings.userId, userId)).limit(1);
  if (rows[0]) return rows[0];
  await db.insert(appSettings).values({ userId });
  return { onboardingComplete: false, scannerEnabled: true, setupCooldownMinutes: 30, strategyEngineStatus: "NOT_RUN" as const, strategyEngineLastRunAt: null, strategyEngineLastError: null, strategyEngineTotalSnapshots: 0, strategyEngineCompleteResponses: 0, strategyEngineRetryCount: 0, strategyEngineUnavailableCycles: 0, scheduleCronTaskUid: null };
}

export async function claimOwnerAlert(input: { userId: number; alertType: string; dedupeKey: string; title: string; content: string }) {
  const db = await getDb();
  if (!db) return false;
  await db.insert(ownerAlertLedger).values(input).onDuplicateKeyUpdate({ set: { title: input.title, content: input.content } });
  const rows = await db.select({ notifiedAt: ownerAlertLedger.notifiedAt }).from(ownerAlertLedger).where(eq(ownerAlertLedger.dedupeKey, input.dedupeKey)).limit(1);
  return rows[0]?.notifiedAt == null;
}

export async function markOwnerAlertNotified(dedupeKey: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(ownerAlertLedger).set({ notifiedAt: new Date() }).where(eq(ownerAlertLedger.dedupeKey, dedupeKey));
}

const SCANNER_RUN_NAMESPACE = "trading-guard-scanner";

export function buildScannerRunKey(_taskUid: string, at = new Date()) {
  const fiveMinuteBucket = Math.floor(at.getTime() / (5 * 60 * 1000));
  return `${SCANNER_RUN_NAMESPACE}:${fiveMinuteBucket}`;
}

export async function startScannerRun(taskUid: string, at = new Date()) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const runKey = buildScannerRunKey(taskUid, at);
  // Reclaim stale RUNNING rows across task IDs before checking this callback's
  // lease. This covers disabled legacy schedulers whose final callback never
  // returned, while the bounded lease prevents a slow but healthy run from
  // being reclaimed too early.
  const runningRuns = await db.select().from(scannerRunLedger).where(eq(scannerRunLedger.status, "RUNNING")).orderBy(scannerRunLedger.startedAt).limit(50);
  for (const runningRun of runningRuns) {
    if (isStaleScannerRun(runningRun, at)) {
      await db.update(scannerRunLedger).set({ status: "FAILED", finishedAt: at, marketData: "unavailable", error: `Scanner run lease expired before callback completion: ${runningRun.runKey}` }).where(eq(scannerRunLedger.id, runningRun.id));
    }
  }
  const activeRuns = await db.select().from(scannerRunLedger).where(and(eq(scannerRunLedger.taskUid, taskUid), eq(scannerRunLedger.status, "RUNNING"))).orderBy(desc(scannerRunLedger.startedAt)).limit(1);
  const active = activeRuns[0];
  if (active && active.runKey !== runKey) {
    if (isStaleScannerRun(active, at)) {
      await db.update(scannerRunLedger).set({ status: "FAILED", finishedAt: at, marketData: "unavailable", error: `Scanner run lease expired before callback completion: ${active.runKey}` }).where(eq(scannerRunLedger.id, active.id));
    } else {
      await db.update(scannerRunLedger).set({ duplicateCallbacks: sql`${scannerRunLedger.duplicateCallbacks} + 1`, lastDuplicateAt: at }).where(eq(scannerRunLedger.id, active.id));
      return { row: { ...active, duplicateCallbacks: Number(active.duplicateCallbacks ?? 0) + 1, lastDuplicateAt: at }, duplicate: true };
    }
  }
  const existing = await db.select().from(scannerRunLedger).where(eq(scannerRunLedger.runKey, runKey)).limit(1);
  if (existing[0]) {
    if (isStaleScannerRun(existing[0], at)) {
      await db.update(scannerRunLedger).set({ startedAt: at, finishedAt: null, status: "RUNNING", usersProcessed: 0, createdSignals: 0, trackedSignals: 0, adjustments: 0, marketData: "not-run", error: null }).where(eq(scannerRunLedger.id, existing[0].id));
      const reclaimed = await db.select().from(scannerRunLedger).where(eq(scannerRunLedger.id, existing[0].id)).limit(1);
      return { row: reclaimed[0], duplicate: false, reclaimed: true };
    }
    await db.update(scannerRunLedger).set({ duplicateCallbacks: sql`${scannerRunLedger.duplicateCallbacks} + 1`, lastDuplicateAt: at }).where(eq(scannerRunLedger.id, existing[0].id));
    return { row: { ...existing[0], duplicateCallbacks: Number(existing[0].duplicateCallbacks ?? 0) + 1, lastDuplicateAt: at }, duplicate: true };
  }
  try {
    const result = await db.insert(scannerRunLedger).values({ taskUid, runKey, startedAt: at, status: "RUNNING" });
    const rows = await db.select().from(scannerRunLedger).where(eq(scannerRunLedger.id, Number(result[0].insertId))).limit(1);
    return { row: rows[0], duplicate: false };
  } catch (error) {
    const raced = await db.select().from(scannerRunLedger).where(eq(scannerRunLedger.runKey, runKey)).limit(1);
    if (raced[0]) return { row: raced[0], duplicate: true };
    throw error;
  }
}

export async function finishScannerRun(id: number, input: { status: "SUCCEEDED" | "FAILED"; usersProcessed?: number; createdSignals?: number; trackedSignals?: number; adjustments?: number; marketData?: "available" | "unavailable" | "not-run"; error?: string | null }) {
  const db = await getDb();
  if (!db) return;
  await db.update(scannerRunLedger).set({ ...input, finishedAt: new Date(), error: input.error ?? null }).where(eq(scannerRunLedger.id, id));
}

export async function listRecentScannerRuns(taskUid: string, limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(scannerRunLedger).where(eq(scannerRunLedger.taskUid, taskUid)).orderBy(desc(scannerRunLedger.startedAt)).limit(limit);
}

export async function getScannerCadenceDiagnostics(userId: number, now = new Date()) {
  const db = await getDb();
  if (!db) return { checkedAt: now, windowHours: 24, expectedIntervalMinutes: 5, observedWindows: 0, receivedCycles: 0, completedCycles: 0, failedCycles: 0, skippedWindows: 0, duplicateSuppressed: 0, averageIntervalMinutes: null, lastRunAt: null, lastSource: null, latestSuccessfulAt: null, latestSuccessfulSource: null, externalCycles: 0, heartbeatCycles: 0, providerUnavailableCycles: 0, providerUnavailableWindows: 0, latestProviderIssue: null, latestTimeframeHealth: [{ interval: "15min", status: "NOT_RECORDED", at: null }, { interval: "1h", status: "NOT_RECORDED", at: null }, { interval: "4h", status: "NOT_RECORDED", at: null }], runs: [] };
  const settings = await getSettings(userId);
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const taskUids = [settings.scheduleCronTaskUid, "external-cron-job"].filter((taskUid): taskUid is string => Boolean(taskUid));
  const rows = taskUids.length ? await db.select().from(scannerRunLedger).where(and(gte(scannerRunLedger.startedAt, since), inArray(scannerRunLedger.taskUid, taskUids))).orderBy(desc(scannerRunLedger.startedAt)).limit(500) : [];
  return { checkedAt: now, windowHours: 24, expectedIntervalMinutes: 5, ...summarizeScannerCadence(rows) };
}

export async function updateStrategyEngineStatus(userId: number, input: { status: "AVAILABLE" | "UNAVAILABLE" | "NOT_RUN"; error?: string | null }) {
  const db = await getDb();
  if (!db) return;
  await db.insert(appSettings).values({ userId, strategyEngineStatus: input.status, strategyEngineLastRunAt: new Date(), strategyEngineLastError: input.error ?? null }).onDuplicateKeyUpdate({ set: { strategyEngineStatus: input.status, strategyEngineLastRunAt: new Date(), strategyEngineLastError: input.error ?? null } });
}

export async function recordStrategyEngineHealth(userId: number, input: { snapshots: number; completeResponses: number; retries: number; unavailableCycle?: boolean }) {
  const db = await getDb();
  if (!db) return;
  const current = await db.select({ total: appSettings.strategyEngineTotalSnapshots, complete: appSettings.strategyEngineCompleteResponses, retries: appSettings.strategyEngineRetryCount, unavailable: appSettings.strategyEngineUnavailableCycles }).from(appSettings).where(eq(appSettings.userId, userId)).limit(1);
  const row = current[0] ?? { total: 0, complete: 0, retries: 0, unavailable: 0 };
  await db.insert(appSettings).values({ userId, strategyEngineTotalSnapshots: row.total + input.snapshots, strategyEngineCompleteResponses: row.complete + input.completeResponses, strategyEngineRetryCount: row.retries + input.retries, strategyEngineUnavailableCycles: row.unavailable + (input.unavailableCycle ? 1 : 0) }).onDuplicateKeyUpdate({ set: { strategyEngineTotalSnapshots: row.total + input.snapshots, strategyEngineCompleteResponses: row.complete + input.completeResponses, strategyEngineRetryCount: row.retries + input.retries, strategyEngineUnavailableCycles: row.unavailable + (input.unavailableCycle ? 1 : 0) } });
}

export async function updateSetupCooldown(userId: number, minutes: number) {
  const db = await getDb();
  if (!db) return;
  await db.insert(appSettings).values({ userId, setupCooldownMinutes: minutes }).onDuplicateKeyUpdate({ set: { setupCooldownMinutes: minutes } });
}

export async function createStrategyDecision(input: typeof strategyDecisionLedger.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.insert(strategyDecisionLedger).values(input);
  return { id: Number(result[0].insertId), ...input };
}

export type LiveMarketPulseRow = {
  asset: string;
  price: number | null;
  candleTime: string | null;
  savedAt: Date | null;
  timeframe: string;
  interval: string | null;
  trend: string | null;
};

export function summarizeLiveMarketPulse(rows: Array<{ asset: string; timeframe: string; marketSnapshot: string | null; createdAt: Date }>): LiveMarketPulseRow[] {
  const seen = new Set<string>();
  const result: LiveMarketPulseRow[] = [];
  for (const row of rows) {
    if (seen.has(row.asset)) continue;
    seen.add(row.asset);
    try {
      const snapshot = JSON.parse(row.marketSnapshot ?? "{}") as { price?: unknown; close?: unknown; interval?: unknown; trend?: unknown; values?: Array<{ datetime?: unknown; close?: unknown }> };
      const latestValue = Array.isArray(snapshot.values) ? snapshot.values.at(-1) : undefined;
      const rawPrice = snapshot.price ?? snapshot.close ?? latestValue?.close;
      const price = typeof rawPrice === "number" ? rawPrice : typeof rawPrice === "string" && Number.isFinite(Number(rawPrice)) ? Number(rawPrice) : null;
      const candleTime = typeof latestValue?.datetime === "string" ? latestValue.datetime : null;
      result.push({
        asset: row.asset,
        price,
        candleTime,
        savedAt: row.createdAt,
        timeframe: row.timeframe,
        interval: typeof snapshot.interval === "string" ? snapshot.interval : null,
        trend: typeof snapshot.trend === "string" ? snapshot.trend : null,
      });
    } catch {
      result.push({ asset: row.asset, price: null, candleTime: null, savedAt: row.createdAt, timeframe: row.timeframe, interval: null, trend: null });
    }
  }
  return result;
}

export async function getLiveMarketPulse(userId: number): Promise<LiveMarketPulseRow[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ asset: strategyDecisionLedger.asset, timeframe: strategyDecisionLedger.timeframe, marketSnapshot: strategyDecisionLedger.marketSnapshot, createdAt: strategyDecisionLedger.createdAt }).from(strategyDecisionLedger).where(eq(strategyDecisionLedger.userId, userId)).orderBy(desc(strategyDecisionLedger.createdAt)).limit(500);
  return summarizeLiveMarketPulse(rows);
}

export async function listStrategyDecisions(userId: number, filters: DecisionFilters = {}) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(strategyDecisionLedger).where(eq(strategyDecisionLedger.userId, userId)).orderBy(desc(strategyDecisionLedger.createdAt)).limit(SCANNER_DASHBOARD_LIMIT);
  return filterStrategyDecisions(rows, filters);
}

const DASHBOARD_EVIDENCE_PREVIEW_CHARS = 12_000;
const DASHBOARD_FINDINGS_PREVIEW_CHARS = 8_000;
const DASHBOARD_SNAPSHOT_PREVIEW_CHARS = 16_000;
const DASHBOARD_REASON_PREVIEW_CHARS = 4_000;

export async function listStrategyDecisionsForDashboard(userId: number, filters: DecisionFilters = {}) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    id: strategyDecisionLedger.id,
    userId: strategyDecisionLedger.userId,
    asset: strategyDecisionLedger.asset,
    timeframe: strategyDecisionLedger.timeframe,
    verdict: strategyDecisionLedger.verdict,
    confidence: strategyDecisionLedger.confidence,
    confluenceScore: strategyDecisionLedger.confluenceScore,
    ruleEvidence: sql<string | null>`LEFT(${strategyDecisionLedger.ruleEvidence}, ${DASHBOARD_EVIDENCE_PREVIEW_CHARS})`.as("ruleEvidence"),
    ruleFindings: sql<string | null>`LEFT(${strategyDecisionLedger.ruleFindings}, ${DASHBOARD_FINDINGS_PREVIEW_CHARS})`.as("ruleFindings"),
    marketSnapshot: sql<string | null>`LEFT(${strategyDecisionLedger.marketSnapshot}, ${DASHBOARD_SNAPSHOT_PREVIEW_CHARS})`.as("marketSnapshot"),
    generatedDirection: strategyDecisionLedger.generatedDirection,
    generatedEntry: strategyDecisionLedger.generatedEntry,
    generatedStopLoss: strategyDecisionLedger.generatedStopLoss,
    generatedTakeProfit: strategyDecisionLedger.generatedTakeProfit,
    decisionReason: sql<string | null>`LEFT(${strategyDecisionLedger.decisionReason}, ${DASHBOARD_REASON_PREVIEW_CHARS})`.as("decisionReason"),
    cooldownKey: strategyDecisionLedger.cooldownKey,
    createdAt: strategyDecisionLedger.createdAt,
  }).from(strategyDecisionLedger).where(eq(strategyDecisionLedger.userId, userId)).orderBy(desc(strategyDecisionLedger.createdAt)).limit(SCANNER_DASHBOARD_LIMIT);
  return filterStrategyDecisions(rows, filters);
}

export async function getV5HierarchySmokeStatus(userId: number, lookbackMinutes = 30) {
  const db = await getDb();
  if (!db) return { ok: false, reason: "Database is unavailable.", checkedDecisions: 0, qualified: 0, waiting: 0, actualRatios: [], latestCycleAt: null as Date | null, payloadChecks: [], zoneInventory: { total: 0, active: 0, weakened: 0, invalidated: 0 } };
  const since = new Date(Date.now() - lookbackMinutes * 60_000);
  const [decisions, runs, zoneHistory] = await Promise.all([
    db.select({ id: strategyDecisionLedger.id, asset: strategyDecisionLedger.asset, timeframe: strategyDecisionLedger.timeframe, marketSnapshot: strategyDecisionLedger.marketSnapshot, createdAt: strategyDecisionLedger.createdAt }).from(strategyDecisionLedger).where(and(eq(strategyDecisionLedger.userId, userId), gte(strategyDecisionLedger.createdAt, since))).orderBy(desc(strategyDecisionLedger.createdAt)).limit(SCANNER_SMOKE_LIMIT),
    db.select().from(scannerRunLedger).where(and(gte(scannerRunLedger.finishedAt, since), eq(scannerRunLedger.status, "SUCCEEDED"))).orderBy(desc(scannerRunLedger.finishedAt)).limit(20),
    db.select({ lifecycle: v5ZoneHistory.lifecycle }).from(v5ZoneHistory).where(eq(v5ZoneHistory.userId, userId)).limit(SCANNER_SMOKE_LIMIT),
  ]);
  const payloadChecks = decisions.map((decision) => {
    try {
      const snapshot = JSON.parse(decision.marketSnapshot ?? "{}");
      const workflow = snapshot?.replacementIntelligence?.workflow;
      return { id: decision.id, asset: decision.asset, timeframe: decision.timeframe, complete: Boolean(workflow && Array.isArray(workflow.zones) && workflow.confirmation && ["QUALIFIED", "WAITING"].includes(workflow.status)), zoneCount: Array.isArray(workflow?.zones) ? workflow.zones.length : 0, status: workflow?.status ?? "MISSING" };
    } catch {
      return { id: decision.id, asset: decision.asset, timeframe: decision.timeframe, complete: false, zoneCount: 0, status: "INVALID_JSON" };
    }
  });
  const hierarchyRows = decisions.flatMap((decision) => {
    try {
      const snapshot = JSON.parse(decision.marketSnapshot ?? "{}");
      const workflow = snapshot?.replacementIntelligence?.workflow;
      if (!workflow || !Array.isArray(workflow.zones) || !workflow.confirmation || !["QUALIFIED", "WAITING"].includes(workflow.status)) return [];
      return [{ status: workflow.status as "QUALIFIED" | "WAITING", riskReward: Number(workflow.riskReward), createdAt: decision.createdAt }];
    } catch {
      return [];
    }
  });
  const actualRatios = hierarchyRows.map((row) => row.riskReward).filter(Number.isFinite);
  const qualified = hierarchyRows.filter((row) => row.status === "QUALIFIED").length;
  const waiting = hierarchyRows.filter((row) => row.status === "WAITING").length;
  const latestCycleAt = runs[0]?.finishedAt ?? null;
  const zoneInventory = { total: zoneHistory.length, active: zoneHistory.filter((row) => row.lifecycle === "ACTIVE").length, weakened: zoneHistory.filter((row) => row.lifecycle === "WEAKENED").length, invalidated: zoneHistory.filter((row) => row.lifecycle === "INVALIDATED").length };
  const ok = Boolean(latestCycleAt && hierarchyRows.length && payloadChecks.every((check) => check.complete));
  return { ok, reason: ok ? "Recent successful scanner cycles have complete persisted v5 hierarchy payloads." : "No complete v5 hierarchy payload was found after a recent successful scanner cycle.", checkedDecisions: hierarchyRows.length, qualified, waiting, actualRatios, latestCycleAt, payloadChecks: payloadChecks.slice(0, 40), zoneInventory };
}

export async function listStrategyDecisionsSince(userId: number, since: Date) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(strategyDecisionLedger).where(and(eq(strategyDecisionLedger.userId, userId), gte(strategyDecisionLedger.createdAt, since))).orderBy(desc(strategyDecisionLedger.createdAt)).limit(SCANNER_DASHBOARD_LIMIT);
}

export async function hasRecentStrategyDecision(userId: number, cooldownKey: string, since: Date) {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select({ id: strategyDecisionLedger.id }).from(strategyDecisionLedger).where(and(eq(strategyDecisionLedger.userId, userId), eq(strategyDecisionLedger.cooldownKey, cooldownKey), gte(strategyDecisionLedger.createdAt, since))).limit(1);
  return rows.length > 0;
}

export function summarizeStrategyEngineHealth(input: { strategyEngineTotalSnapshots?: number | null; strategyEngineCompleteResponses?: number | null; strategyEngineRetryCount?: number | null; strategyEngineUnavailableCycles?: number | null; strategyEngineStatus?: string | null; strategyEngineLastRunAt?: Date | null; strategyEngineLastError?: string | null }) {
  const snapshots = Number(input.strategyEngineTotalSnapshots ?? 0);
  const completeResponses = Number(input.strategyEngineCompleteResponses ?? 0);
  return {
    status: input.strategyEngineStatus ?? "NOT_RUN",
    totalSnapshots: snapshots,
    completeResponses,
    completenessPercent: snapshots ? Math.round((completeResponses / snapshots) * 100) : 0,
    retryCount: Number(input.strategyEngineRetryCount ?? 0),
    unavailableCycles: Number(input.strategyEngineUnavailableCycles ?? 0),
    lastRunAt: input.strategyEngineLastRunAt ?? null,
    lastError: input.strategyEngineLastError ?? null,
  };
}

export function summarizeStrategyDecisions(decisions: Array<{ verdict: string }>) {
  return {
    total: decisions.length,
    approved: decisions.filter((decision) => decision.verdict === "APPROVED").length,
    denied: decisions.filter((decision) => decision.verdict === "DENIED").length,
    skipped: decisions.filter((decision) => decision.verdict === "SKIPPED").length,
    unavailable: decisions.filter((decision) => decision.verdict === "UNAVAILABLE").length,
  };
}

export function summarizeJudgmentAlertBridge(judgment: { total: number; approved: number }, delivery: { signalDelivered: number }) {
  return {
    directionalJudgments: judgment.total,
    approvedJudgments: judgment.approved,
    telegramDelivered: delivery.signalDelivered,
  };
}

export async function getStrategyEngineHealth(userId: number) {
  return summarizeStrategyEngineHealth(await getSettings(userId));
}

export async function getStrategyDecisionSummary(userId: number) {
  const db = await getDb();
  if (!db) return summarizeStrategyDecisions([]);
  const decisions = await db.select({ verdict: strategyDecisionLedger.verdict }).from(strategyDecisionLedger).where(eq(strategyDecisionLedger.userId, userId));
  return summarizeStrategyDecisions(decisions);
}

export async function recordCooldownChange(input: { userId: number; previousMinutes: number; newMinutes: number }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.insert(cooldownChangeLog).values(input);
  return { id: Number(result[0].insertId), ...input };
}

export async function listCooldownChanges(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(cooldownChangeLog).where(eq(cooldownChangeLog.userId, userId)).orderBy(desc(cooldownChangeLog.changedAt)).limit(20);
}

export async function markOnboardingComplete(userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.insert(appSettings).values({ userId, onboardingComplete: true }).onDuplicateKeyUpdate({ set: { onboardingComplete: true } });
}

export function buildBoundedRuleText(rules: Array<{ title?: string | null; content?: string | null }>, maxChars = 60_000) {
  const sections: string[] = [];
  let chars = 0;
  for (const rule of rules) {
    if (chars >= maxChars) break;
    const remaining = maxChars - chars;
    const section = `## ${rule.title ?? "Saved strategy rule"}\n${rule.content ?? ""}`;
    sections.push(section.slice(0, remaining));
    chars += Math.min(section.length, remaining) + 2;
  }
  return sections.join("\n\n").slice(0, maxChars);
}

export async function getAllRulesText(userId: number, maxChars = 60_000) {
  return buildBoundedRuleText(await listStrategyRules(userId), maxChars);
}

export async function getRelevantRulesText(userId: number, query: string, maxChars = 120_000) {
  const rules = await listStrategyRules(userId);
  const queryTokens = new Set((query.toLowerCase().match(/[a-z0-9%/]+/g) ?? []).filter((token) => token.length > 2));
  const scored = rules.map((rule) => {
    const titleAndContent = `${rule.title} ${rule.content}`.toLowerCase();
    const titleTokens = new Set((rule.title.toLowerCase().match(/[a-z0-9%/]+/g) ?? []).filter((token) => token.length > 2));
    const queryTokenList = Array.from(queryTokens);
    const overlap = queryTokenList.filter((token) => titleAndContent.includes(token)).length;
    const titleOverlap = queryTokenList.filter((token) => titleTokens.has(token)).length;
    const paragraphs = rule.content.split(/\n\s*\n|(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
    const excerpts = paragraphs.filter((part) => Array.from(queryTokens).some((token) => part.toLowerCase().includes(token))).slice(0, 6);
    return { rule, score: overlap + titleOverlap * 3, excerpts: excerpts.length ? excerpts : paragraphs.slice(0, 2) };
  }).sort((a, b) => b.score - a.score || b.rule.createdAt.getTime() - a.rule.createdAt.getTime());
  const sections: string[] = [];
  let chars = 0;
  for (const item of scored) {
    const section = `## ${item.rule.title}\nSource: ${item.rule.sourceFileName ?? "saved strategy rule"}\n${item.excerpts.join(" ")}`;
    if (chars + section.length > maxChars && sections.length > 0) continue;
    sections.push(section);
    chars += section.length + 2;
    if (chars >= maxChars) break;
  }
  return sections.join("\n\n");
}


type ReplacementOutcomeRow = { status: string; intelligenceComponents: string | null; marketRegime: string | null; confidence?: string | number | null };
type ReplacementOutcomeBucket = { key: string; total: number; wins: number; losses: number; pending: number; invalidated: number; superseded: number };
export function summarizeReplacementOutcomes(rows: ReplacementOutcomeRow[], version: "replacement-forex-v2" | "replacement-forex-v3" | "replacement-forex-v5" | "replacement-forex-v5-locator" = "replacement-forex-v2") {
  const componentMap = new Map<string, ReplacementOutcomeBucket>();
  const regimeMap = new Map<string, ReplacementOutcomeBucket>();
  const confidenceMap = new Map<string, ReplacementOutcomeBucket>();
  const add = (map: Map<string, ReplacementOutcomeBucket>, key: string, status: string) => {
    const bucket = map.get(key) ?? { key, total: 0, wins: 0, losses: 0, pending: 0, invalidated: 0, superseded: 0 };
    bucket.total += 1;
    if (status === "WIN") bucket.wins += 1;
    else if (status === "LOSS") bucket.losses += 1;
    else if (status === "INVALIDATED") bucket.invalidated += 1;
    else if (status === "SUPERSEDED") bucket.superseded += 1;
    else bucket.pending += 1;
    map.set(key, bucket);
  };
  for (const row of rows) {
    const components = (() => { try { const parsed = JSON.parse(row.intelligenceComponents ?? "[]"); return Array.isArray(parsed) ? parsed : []; } catch { return []; } })();
    for (const component of components) if (typeof component === "string" && component.trim()) add(componentMap, component, row.status);
    add(regimeMap, row.marketRegime ?? "UNKNOWN", row.status);
    const confidence = Number(row.confidence);
    const confidenceBand = Number.isFinite(confidence) ? confidence >= 90 ? "90-94" : confidence >= 75 ? "75-89" : confidence >= 60 ? "60-74" : "40-59" : "UNKNOWN";
    add(confidenceMap, confidenceBand, row.status);
  }
  const withRate = (bucket: ReplacementOutcomeBucket) => ({ ...bucket, resolved: bucket.wins + bucket.losses, winRate: bucket.wins + bucket.losses ? Math.round((bucket.wins / (bucket.wins + bucket.losses)) * 100) : null });
  const wins = rows.filter((row) => row.status === "WIN").length;
  const losses = rows.filter((row) => row.status === "LOSS").length;
  const resolved = wins + losses;
  return { version, total: rows.length, components: Array.from(componentMap.values()).map(withRate).sort((a, b) => b.total - a.total), regimes: Array.from(regimeMap.values()).map(withRate).sort((a, b) => b.total - a.total), confidenceBands: Array.from(confidenceMap.values()).map(withRate).sort((a, b) => a.key.localeCompare(b.key)), validation: { resolved, wins, losses, pending: rows.filter((row) => row.status === "PENDING").length, invalidated: rows.filter((row) => row.status === "INVALIDATED").length, superseded: rows.filter((row) => row.status === "SUPERSEDED").length, winRate: resolved ? Math.round((wins / resolved) * 100) : null, reviewThreshold: 50, reviewReady: resolved >= 50, reviewStatus: resolved >= 50 ? "READY_FOR_REVIEW" as const : "COLLECTING_EVIDENCE" as const } };
}

export async function getReplacementOutcomeStats(userId: number) {
  const db = await getDb();
  if (!db) return summarizeReplacementOutcomes([]);
  const rows = await db.select({ status: generatedSignals.status, intelligenceComponents: generatedSignals.intelligenceComponents, marketRegime: generatedSignals.marketRegime, confidence: generatedSignals.confidence }).from(generatedSignals).where(and(eq(generatedSignals.userId, userId), eq(generatedSignals.intelligenceVersion, "forex-trading-combined-document-v5")));
  return summarizeReplacementOutcomes(rows, "replacement-forex-v5");
}

export async function getLocatorV5OutcomeStats(userId: number) {
  const db = await getDb();
  if (!db) return summarizeReplacementOutcomes([], "replacement-forex-v5-locator");
  const rows = await db.select({ status: generatedSignals.status, intelligenceComponents: generatedSignals.intelligenceComponents, marketRegime: generatedSignals.marketRegime, confidence: generatedSignals.confidence }).from(generatedSignals).where(and(eq(generatedSignals.userId, userId), eq(generatedSignals.intelligenceVersion, "forex-trading-combined-document-v5"), eq(generatedSignals.generationMode, ENTRY_LOCATOR_V5_GENERATION_MODE)));
  return summarizeReplacementOutcomes(rows, "replacement-forex-v5-locator");
}

type WinningRateRow = { version: string; asset: string; timeframe: string; confidence: string | number | null; status: string };
export type WinningRateMetric = { generated: number; resolved: number; wins: number; losses: number; winRate: number | null };
export type WinningRateBucket = WinningRateMetric & { key: string };
const WINNING_RATE_ASSETS = ["EUR/USD", "XAU/USD", "GBP/USD", "BTC/USD"] as const;
const WINNING_RATE_TIMEFRAMES = ["15MIN", "1H"] as const;
const WINNING_RATE_BANDS = ["100-90", "89-80", "79-70", "69-60", "59-40"] as const;
const WINNING_RATE_VERSIONS = ["replacement-forex-v1", "forex-trading-combined-document-v2", "forex-trading-combined-document-v3", "forex-trading-combined-document-v5"] as const;

function emptyWinningRateMetric(): WinningRateMetric { return { generated: 0, resolved: 0, wins: 0, losses: 0, winRate: null }; }
function updateWinningRateMetric(metric: WinningRateMetric, status: string) {
  metric.generated += 1;
  if (status === "WIN") metric.wins += 1;
  if (status === "LOSS") metric.losses += 1;
  metric.resolved = metric.wins + metric.losses;
  metric.winRate = metric.resolved ? Math.round((metric.wins / metric.resolved) * 100) : null;
}
function confidenceBand(value: string | number | null) {
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) return "UNKNOWN";
  if (confidence >= 90) return "100-90";
  if (confidence >= 80) return "89-80";
  if (confidence >= 70) return "79-70";
  if (confidence >= 60) return "69-60";
  if (confidence >= 40) return "59-40";
  return "BELOW-40";
}
export function summarizeWinningRate(rows: WinningRateRow[]) {
  const byVersion = WINNING_RATE_VERSIONS.map((version) => {
    const versionRows = rows.filter((row) => row.version === version);
    const overall = emptyWinningRateMetric();
    versionRows.forEach((row) => updateWinningRateMetric(overall, row.status));
    const assets = WINNING_RATE_ASSETS.map((asset) => { const metric = emptyWinningRateMetric(); versionRows.filter((row) => row.asset === asset).forEach((row) => updateWinningRateMetric(metric, row.status)); return { key: asset, ...metric }; });
    const timeframes = WINNING_RATE_ASSETS.flatMap((asset) => WINNING_RATE_TIMEFRAMES.map((timeframe) => { const metric = emptyWinningRateMetric(); versionRows.filter((row) => row.asset === asset && row.timeframe === timeframe).forEach((row) => updateWinningRateMetric(metric, row.status)); return { key: `${asset} · ${timeframe}`, asset, timeframe, ...metric }; }));
    const confidenceBands = [...WINNING_RATE_BANDS, "UNKNOWN"].map((band) => { const metric = emptyWinningRateMetric(); versionRows.filter((row) => confidenceBand(row.confidence) === band).forEach((row) => updateWinningRateMetric(metric, row.status)); return { key: band, ...metric }; });
    const confidenceByAssetTimeframe = WINNING_RATE_ASSETS.flatMap((asset) => WINNING_RATE_TIMEFRAMES.flatMap((timeframe) => [...WINNING_RATE_BANDS, "UNKNOWN"].map((band) => { const metric = emptyWinningRateMetric(); versionRows.filter((row) => row.asset === asset && row.timeframe === timeframe && confidenceBand(row.confidence) === band).forEach((row) => updateWinningRateMetric(metric, row.status)); return { key: `${asset} · ${timeframe} · ${band}`, asset, timeframe, confidenceBand: band, ...metric }; })));
    return { version, overall, assets, timeframes, confidenceBands, confidenceByAssetTimeframe };
  });
  return { versions: byVersion, confidenceBandLabels: [...WINNING_RATE_BANDS], assets: [...WINNING_RATE_ASSETS], timeframes: [...WINNING_RATE_TIMEFRAMES] };
}
export type WinningRateReconciliation = { sourceTotal: number; includedTotal: number; excludedTotal: number; status: "RECONCILED" | "MISMATCH" };
export function buildWinningRateReconciliation(sourceTotal: number, includedTotal: number): WinningRateReconciliation {
  const excludedTotal = Math.max(sourceTotal - includedTotal, 0);
  return { sourceTotal, includedTotal, excludedTotal, status: excludedTotal ? "MISMATCH" : "RECONCILED" };
}
export type AdaptiveRatioMetric = { ratio: number; generated: number; resolved: number; wins: number; losses: number; winRate: number | null };
const ADAPTIVE_RATIOS = [3, 2, 1.5, 1] as const;
export function summarizeAdaptiveRatioStats(rows: Array<{ riskReward: string | number | null; status: string }>) {
  return ADAPTIVE_RATIOS.map((ratio) => {
    const matching = rows.filter((row) => Math.abs(Number(row.riskReward) - ratio) < 0.01);
    const wins = matching.filter((row) => row.status === "WIN").length;
    const losses = matching.filter((row) => row.status === "LOSS").length;
    const resolved = wins + losses;
    return { ratio, generated: matching.length, resolved, wins, losses, winRate: resolved ? Math.round((wins / resolved) * 100) : null };
  });
}
export type V5SourceMetric = { source: "ENTRY_LOCATOR"; generated: number; resolved: number; wins: number; losses: number; winRate: number | null };
const V5_SOURCE_MODES = [ENTRY_LOCATOR_V5_GENERATION_MODE] as const;

export function summarizeV5SourceStats(rows: Array<{ generationMode: string | null; status: string }>): V5SourceMetric[] {
  return V5_SOURCE_MODES.map((mode) => {
    const matching = rows.filter((row) => row.generationMode === mode);
    const wins = matching.filter((row) => row.status === "WIN").length;
    const losses = matching.filter((row) => row.status === "LOSS").length;
    const resolved = wins + losses;
    return { source: "ENTRY_LOCATOR" as const, generated: matching.length, resolved, wins, losses, winRate: resolved ? Math.round((wins / resolved) * 100) : null };
  });
}

export async function getV5SourceStats(userId: number, filters: { asset?: string; timeframe?: string; source?: "ENTRY_LOCATOR" } = {}) {
  const db = await getDb();
  const selectedMode = ENTRY_LOCATOR_V5_GENERATION_MODE;
  if (!db) return { sources: summarizeV5SourceStats([]), generatedAt: new Date(), asset: filters.asset ?? "ALL", timeframe: filters.timeframe ?? "ALL", source: filters.source ?? "ALL" };
  const predicates = [eq(generatedSignals.userId, userId), eq(generatedSignals.intelligenceVersion, "forex-trading-combined-document-v5"), eq(generatedSignals.generationMode, selectedMode)];
  if (filters.asset) predicates.push(eq(generatedSignals.asset, filters.asset));
  if (filters.timeframe) predicates.push(eq(generatedSignals.timeframe, filters.timeframe));
  const rows = await db.select({ generationMode: generatedSignals.generationMode, status: generatedSignals.status }).from(generatedSignals).where(and(...predicates));
  return { sources: summarizeV5SourceStats(rows), generatedAt: new Date(), asset: filters.asset ?? "ALL", timeframe: filters.timeframe ?? "ALL", source: filters.source ?? "ALL" };
}

export async function getAdaptiveRatioStats(userId: number, filters: { asset?: string; timeframe?: string } = {}) {
  const db = await getDb();
  if (!db) return { ratios: summarizeAdaptiveRatioStats([]), generatedAt: new Date(), asset: filters.asset ?? "ALL", timeframe: filters.timeframe ?? "ALL" };
  const predicates = [eq(generatedSignals.userId, userId), eq(generatedSignals.intelligenceVersion, "forex-trading-combined-document-v5"), eq(generatedSignals.generationMode, ENTRY_LOCATOR_V5_GENERATION_MODE)];
  if (filters.asset) predicates.push(eq(generatedSignals.asset, filters.asset));
  if (filters.timeframe) predicates.push(eq(generatedSignals.timeframe, filters.timeframe));
  const rows = await db.select({ riskReward: generatedSignals.riskReward, status: generatedSignals.status }).from(generatedSignals).where(and(...predicates));
  return { ratios: summarizeAdaptiveRatioStats(rows), generatedAt: new Date(), asset: filters.asset ?? "ALL", timeframe: filters.timeframe ?? "ALL" };
}

export async function getWinningRateStats(userId: number) {
  const db = await getDb();
  if (!db) return { ...summarizeWinningRate([]), generatedAt: new Date(), reconciliation: buildWinningRateReconciliation(0, 0) };
  const [rows, sourceCountRows] = await Promise.all([
    db.select({ version: generatedSignals.intelligenceVersion, asset: generatedSignals.asset, timeframe: generatedSignals.timeframe, confidence: generatedSignals.confidence, status: generatedSignals.status }).from(generatedSignals).where(and(eq(generatedSignals.userId, userId), inArray(generatedSignals.intelligenceVersion, [...WINNING_RATE_VERSIONS]))),
    db.select({ total: count() }).from(generatedSignals).where(eq(generatedSignals.userId, userId)),
  ]);
  return { ...summarizeWinningRate(rows.map((row) => ({ ...row, version: row.version ?? "" }))), generatedAt: new Date(), reconciliation: buildWinningRateReconciliation(Number(sourceCountRows[0]?.total ?? 0), rows.length) };
}
export async function listExcludedWinningRateSignals(userId: number, limit = 100) {
  const db = await getDb();
  if (!db) return [];
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
  return db.select({ id: generatedSignals.id, asset: generatedSignals.asset, timeframe: generatedSignals.timeframe, direction: generatedSignals.direction, entry: generatedSignals.entry, stopLoss: generatedSignals.stopLoss, takeProfit: generatedSignals.takeProfit, confidence: generatedSignals.confidence, status: generatedSignals.status, intelligenceVersion: generatedSignals.intelligenceVersion, openedAt: generatedSignals.openedAt, closedAt: generatedSignals.closedAt }).from(generatedSignals).where(and(eq(generatedSignals.userId, userId), or(isNull(generatedSignals.intelligenceVersion), notInArray(generatedSignals.intelligenceVersion, [...WINNING_RATE_VERSIONS])))).orderBy(desc(generatedSignals.openedAt)).limit(safeLimit);
}

type TimingSignalRow = { version: string; asset: string; timeframe: string; status: string; openedAt: Date | string };
export type TimingMetric = WinningRateMetric & { takeProfitHits: number; stopLossHits: number };
export type TimingBucket = TimingMetric & { key: string; label: string };
export type TimingGroup = { version: string; asset: string; timeframe: string; buckets: TimingBucket[] };

function emptyTimingMetric(): TimingMetric { return { ...emptyWinningRateMetric(), takeProfitHits: 0, stopLossHits: 0 }; }
function updateTimingMetric(metric: TimingMetric, status: string) {
  updateWinningRateMetric(metric, status);
  if (status === "WIN") metric.takeProfitHits += 1;
  if (status === "LOSS") metric.stopLossHits += 1;
  metric.winRate = metric.resolved ? Math.round((metric.takeProfitHits / metric.resolved) * 100) : null;
}
function buildTimingGroups(rows: TimingSignalRow[], unit: "hour" | "day") {
  const labels = unit === "hour" ? Array.from({ length: 24 }, (_, hour) => ({ key: String(hour), label: `${String(hour).padStart(2, "0")}:00 UTC` })) : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((label, index) => ({ key: String(index), label }));
  return WINNING_RATE_VERSIONS.flatMap((version) => WINNING_RATE_ASSETS.flatMap((asset) => WINNING_RATE_TIMEFRAMES.map((timeframe) => ({
    version,
    asset,
    timeframe,
    buckets: labels.map((bucket) => {
      const metric = emptyTimingMetric();
      rows.filter((row) => row.version === version && row.asset === asset && row.timeframe === timeframe).forEach((row) => {
        const date = new Date(row.openedAt);
        const key = unit === "hour" ? String(date.getUTCHours()) : String((date.getUTCDay() + 6) % 7);
        if (key === bucket.key) updateTimingMetric(metric, row.status);
      });
      return { ...bucket, ...metric };
    }),
  }))));
}
export function summarizeBestTimeToTrade(rows: TimingSignalRow[]) { return { unit: "hour" as const, timezone: "UTC", groups: buildTimingGroups(rows, "hour"), versions: [...WINNING_RATE_VERSIONS], assets: [...WINNING_RATE_ASSETS], timeframes: [...WINNING_RATE_TIMEFRAMES] }; }
export function summarizeBestDaysToTrade(rows: TimingSignalRow[]) { return { unit: "day" as const, timezone: "UTC", groups: buildTimingGroups(rows, "day"), versions: [...WINNING_RATE_VERSIONS], assets: [...WINNING_RATE_ASSETS], timeframes: [...WINNING_RATE_TIMEFRAMES] }; }
async function getTimingStats(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({ version: generatedSignals.intelligenceVersion, asset: generatedSignals.asset, timeframe: generatedSignals.timeframe, status: generatedSignals.status, openedAt: generatedSignals.openedAt }).from(generatedSignals).where(and(eq(generatedSignals.userId, userId), inArray(generatedSignals.intelligenceVersion, [...WINNING_RATE_VERSIONS])));
}
export async function getBestTimeToTradeStats(userId: number) { return summarizeBestTimeToTrade((await getTimingStats(userId)).map((row) => ({ ...row, version: row.version ?? "" }))); }
export async function getBestDaysToTradeStats(userId: number) { return summarizeBestDaysToTrade((await getTimingStats(userId)).map((row) => ({ ...row, version: row.version ?? "" }))); }


export type V5MonitoringMetric = { key: string; generated: number; resolved: number; wins: number; losses: number; winRate: number | null };

function emptyV5MonitoringMetric(key: string): V5MonitoringMetric { return { key, generated: 0, resolved: 0, wins: 0, losses: 0, winRate: null }; }
function updateV5MonitoringMetric(metric: V5MonitoringMetric, status: string) {
  metric.generated += 1;
  if (status === "WIN") { metric.wins += 1; metric.resolved += 1; }
  if (status === "LOSS") { metric.losses += 1; metric.resolved += 1; }
  metric.winRate = metric.resolved ? Math.round((metric.wins / metric.resolved) * 100) : null;
}

export function summarizeV5Monitoring(rows: Array<{ asset: string; timeframe: string; direction: string; status: string; marketSnapshot: string | null }>) {
  const dimensions = new Map<string, Map<string, V5MonitoringMetric>>();
  const ensure = (dimension: string, key: string) => {
    if (!dimensions.has(dimension)) dimensions.set(dimension, new Map());
    const map = dimensions.get(dimension)!;
    if (!map.has(key)) map.set(key, emptyV5MonitoringMetric(key));
    return map.get(key)!;
  };
  for (const row of rows) {
    let eventRisk = "UNKNOWN";
    let geometry = "STANDARD";
    let indicatorCount = "UNKNOWN";
    try {
      const snapshot = JSON.parse(row.marketSnapshot ?? "{}");
      eventRisk = snapshot?.fundamentalContext?.eventRisk ?? snapshot?.replacementIntelligence?.fundamentalContext?.eventRisk ?? "UNKNOWN";
      const targetDescription = snapshot?.replacementIntelligence?.decisionTrace?.levelDerivation?.takeProfit ?? "";
      indicatorCount = snapshot?.entryLocator?.indicatorBucket ?? (Number(snapshot?.entryLocator?.strongIndicatorCount) === 1 ? "ONE_STRONG" : Number(snapshot?.entryLocator?.strongIndicatorCount) >= 2 ? "TWO_PLUS" : "UNKNOWN");
      const adjustments = snapshot?.replacementIntelligence?.adjustments ?? "";
      if (String(targetDescription).toLowerCase().includes("too close for 2r") || String(adjustments).toLowerCase().includes("fell back to the minimum 2r")) geometry = "2R_FALLBACK";
    } catch {
      // Older snapshots remain classified as UNKNOWN/STANDARD rather than inferred.
    }
    updateV5MonitoringMetric(ensure("asset", row.asset), row.status);
    updateV5MonitoringMetric(ensure("timeframe", row.timeframe), row.status);
    updateV5MonitoringMetric(ensure("direction", row.direction), row.status);
    updateV5MonitoringMetric(ensure("eventRisk", String(eventRisk)), row.status);
    updateV5MonitoringMetric(ensure("geometry", geometry), row.status);
    updateV5MonitoringMetric(ensure("indicatorCount", indicatorCount), row.status);
  }
  return Object.fromEntries(Array.from(dimensions.entries()).map(([dimension, values]) => [dimension, Array.from(values.values()).sort((a, b) => a.key.localeCompare(b.key))]));
}

export async function getV5MonitoringStats(userId: number) {
  const db = await getDb();
  if (!db) return summarizeV5Monitoring([]);
  const rows = await db.select({ asset: generatedSignals.asset, timeframe: generatedSignals.timeframe, direction: generatedSignals.direction, status: generatedSignals.status, marketSnapshot: strategyDecisionLedger.marketSnapshot }).from(generatedSignals).leftJoin(strategyDecisionLedger, and(eq(strategyDecisionLedger.userId, generatedSignals.userId), eq(strategyDecisionLedger.asset, generatedSignals.asset), eq(strategyDecisionLedger.timeframe, generatedSignals.timeframe), eq(strategyDecisionLedger.generatedDirection, generatedSignals.direction), eq(strategyDecisionLedger.generatedEntry, generatedSignals.entry))).where(and(eq(generatedSignals.userId, userId), eq(generatedSignals.intelligenceVersion, "forex-trading-combined-document-v5")));
  return summarizeV5Monitoring(rows.map((row) => ({ ...row, marketSnapshot: row.marketSnapshot ?? null })));
}
