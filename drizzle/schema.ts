import { boolean, decimal, index, int, mediumtext, mysqlEnum, mysqlTable, text, timestamp, unique, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const strategyRules = mysqlTable("strategy_rules", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  sourceType: mysqlEnum("sourceType", ["pdf", "docx", "text"]).notNull(),
  sourceFileName: varchar("sourceFileName", { length: 255 }),
  content: mediumtext("content").notNull(),
  storageKey: varchar("storageKey", { length: 512 }),
  supabaseId: varchar("supabaseId", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const auditMessages = mysqlTable("audit_messages", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  channel: mysqlEnum("channel", ["WHITE", "CHERRY"]).default("WHITE").notNull(),
  role: mysqlEnum("role", ["user", "assistant"]).notNull(),
  content: text("content").notNull(),
  verdict: mysqlEnum("verdict", ["APPROVED", "DENIED", "PENDING"]),
  confidence: decimal("confidence", { precision: 5, scale: 2 }),
  asset: varchar("asset", { length: 32 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const whiteAiMemories = mysqlTable("white_ai_memories", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  memoryType: mysqlEnum("memoryType", ["CONVERSATION", "PREFERENCE", "LEARNING"]).default("CONVERSATION").notNull(),
  content: varchar("content", { length: 1200 }).notNull(),
  sourceMessageId: int("sourceMessageId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const generatedSignals = mysqlTable("generated_signals", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  asset: varchar("asset", { length: 32 }).notNull(),
  timeframe: varchar("timeframe", { length: 16 }).notNull(),
  direction: mysqlEnum("direction", ["BUY", "SELL"]).notNull(),
  entry: decimal("entry", { precision: 18, scale: 8 }).notNull(),
  stopLoss: decimal("stopLoss", { precision: 18, scale: 8 }).notNull(),
  takeProfit: decimal("takeProfit", { precision: 18, scale: 8 }).notNull(),
  riskReward: decimal("riskReward", { precision: 8, scale: 2 }).notNull(),
  confidence: decimal("confidence", { precision: 5, scale: 2 }).notNull(),
  /** Nullable for legacy signals; populated for current v5 emissions and upgrades. */
  confluenceScore: decimal("confluenceScore", { precision: 5, scale: 2 }),
  rationale: text("rationale"),
  intelligenceVersion: varchar("intelligenceVersion", { length: 64 }),
  /** Null for legacy rows; ENTRY_LOCATOR_V5 for current stateful locator emissions. */
  generationMode: varchar("generationMode", { length: 32 }),
  /** SHA-256 identity of the complete v5 setup; nullable for legacy rows. */
  signalFingerprint: varchar("signalFingerprint", { length: 64 }),
  intelligenceComponents: mediumtext("intelligenceComponents"),
  marketRegime: varchar("marketRegime", { length: 128 }),
  status: mysqlEnum("status", ["PENDING", "WIN", "LOSS", "INVALIDATED", "SUPERSEDED"]).default("PENDING").notNull(),
  /** When false, the signal remains trackable but does not block a new Entry Forger setup. */
  blocksEntryForger: boolean("blocksEntryForger").default(true).notNull(),
  /** Links an older paper signal to the newer signal that superseded it. */
  supersededBySignalId: int("supersededBySignalId"),
  outcomeNote: text("outcomeNote"),
  openedAt: timestamp("openedAt").defaultNow().notNull(),
  closedAt: timestamp("closedAt"),
  /** Evidence used by the tracker when resolving a paper signal. */
  resolutionCandleAt: timestamp("resolutionCandleAt"),
  resolutionPrice: decimal("resolutionPrice", { precision: 18, scale: 8 }),
  resolutionHigh: decimal("resolutionHigh", { precision: 18, scale: 8 }),
  resolutionLow: decimal("resolutionLow", { precision: 18, scale: 8 }),
  resolutionUsedIntrabar: boolean("resolutionUsedIntrabar"),
}, (table) => ({
  signalFingerprintUnique: unique("generated_signals_signal_fingerprint_unique").on(table.signalFingerprint),
}));

export const auditTrades = mysqlTable("audit_trades", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  messageId: int("messageId"),
  asset: varchar("asset", { length: 32 }).notNull(),
  timeframe: varchar("timeframe", { length: 16 }),
  direction: mysqlEnum("direction", ["BUY", "SELL"]),
  entry: decimal("entry", { precision: 18, scale: 8 }),
  stopLoss: decimal("stopLoss", { precision: 18, scale: 8 }),
  takeProfit: decimal("takeProfit", { precision: 18, scale: 8 }),
  verdict: mysqlEnum("verdict", ["APPROVED", "DENIED"]).notNull(),
  confidence: decimal("confidence", { precision: 5, scale: 2 }),
  adjustments: text("adjustments"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const strategyDecisionLedger = mysqlTable("strategy_decision_ledger", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  asset: varchar("asset", { length: 32 }).notNull(),
  timeframe: varchar("timeframe", { length: 16 }).notNull(),
  verdict: mysqlEnum("verdict", ["APPROVED", "DENIED", "SKIPPED", "UNAVAILABLE"]).notNull(),
  confidence: decimal("confidence", { precision: 5, scale: 2 }).notNull(),
  confluenceScore: decimal("confluenceScore", { precision: 5, scale: 2 }).default("0").notNull(),
  ruleEvidence: mediumtext("ruleEvidence"),
  ruleFindings: mediumtext("ruleFindings"),
  marketSnapshot: mediumtext("marketSnapshot"),
  generatedDirection: mysqlEnum("generatedDirection", ["BUY", "SELL"]),
  generatedEntry: decimal("generatedEntry", { precision: 18, scale: 8 }),
  generatedStopLoss: decimal("generatedStopLoss", { precision: 18, scale: 8 }),
  generatedTakeProfit: decimal("generatedTakeProfit", { precision: 18, scale: 8 }),
  decisionReason: text("decisionReason"),
  cooldownKey: varchar("cooldownKey", { length: 255 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const telegramDeliveries = mysqlTable("telegram_deliveries", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  signalId: int("signalId"),
  auditTradeId: int("auditTradeId"),
  kind: mysqlEnum("kind", ["SIGNAL", "AUDIT", "OUTCOME", "SUMMARY", "REASON", "ADJUSTMENT"]).notNull(),
  status: mysqlEnum("status", ["DELIVERED", "FAILED"]).notNull(),
  telegramMessageId: varchar("telegramMessageId", { length: 64 }),
  dedupeKey: varchar("dedupeKey", { length: 255 }).notNull().unique(),
  error: text("error"),
  retryCount: int("retryCount").default(0).notNull(),
  lastRetryAt: timestamp("lastRetryAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  deliveredAt: timestamp("deliveredAt"),
});

export const paperTradeAdjustments = mysqlTable("paper_trade_adjustments", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  signalId: int("signalId").notNull(),
  asset: varchar("asset", { length: 32 }).notNull(),
  timeframe: varchar("timeframe", { length: 16 }).notNull(),
  originalDirection: mysqlEnum("originalDirection", ["BUY", "SELL"]).notNull(),
  observedDirection: mysqlEnum("observedDirection", ["BUY", "SELL"]).notNull(),
  currentPrice: decimal("currentPrice", { precision: 18, scale: 8 }).notNull(),
  confidence: decimal("confidence", { precision: 5, scale: 2 }).notNull(),
  confluenceScore: decimal("confluenceScore", { precision: 5, scale: 2 }).notNull(),
  action: mysqlEnum("action", ["REVIEW_DIRECTION", "TIGHTEN_STOP", "EXIT_PAPER_SETUP", "UPGRADE_PAPER_SETUP"]).notNull(),
  /** Set when this record links an older active signal to a stronger replacement. */
  replacementSignalId: int("replacementSignalId"),
  reason: text("reason").notNull(),
  evidenceJson: mediumtext("evidenceJson").notNull(),
  dedupeKey: varchar("dedupeKey", { length: 255 }).notNull().unique(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const cooldownChangeLog = mysqlTable("cooldown_change_log", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  previousMinutes: int("previousMinutes").notNull(),
  newMinutes: int("newMinutes").notNull(),
  changedAt: timestamp("changedAt").defaultNow().notNull(),
});

export const strategyIntelligenceVersions = mysqlTable("strategy_intelligence_versions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  versionLabel: varchar("versionLabel", { length: 64 }).notNull(),
  status: mysqlEnum("status", ["DRAFT", "VALIDATING", "ACTIVE", "RETIRED"]).default("DRAFT").notNull(),
  sourceRuleCount: int("sourceRuleCount").default(0).notNull(),
  componentCount: int("componentCount").default(0).notNull(),
  lessonCount: int("lessonCount").default(0).notNull(),
  algorithmJson: mediumtext("algorithmJson").notNull(),
  validationJson: mediumtext("validationJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  activatedAt: timestamp("activatedAt"),
});

export const strategyIntelligenceComponents = mysqlTable("strategy_intelligence_components", {
  id: int("id").autoincrement().primaryKey(),
  versionId: int("versionId").notNull(),
  userId: int("userId").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  sourceRuleIds: mediumtext("sourceRuleIds").notNull(),
  trigger: mysqlEnum("trigger", ["MARKET_STRUCTURE", "MOMENTUM", "VOLATILITY", "SUPPORT_RESISTANCE", "BREAKOUT", "CANDLE"]).notNull(),
  stance: mysqlEnum("stance", ["BUY", "SELL", "NEUTRAL"]).notNull(),
  conditionJson: mediumtext("conditionJson").notNull(),
  weight: decimal("weight", { precision: 8, scale: 3 }).default("1").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const strategyLessons = mysqlTable("strategy_lessons", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  signalId: int("signalId"),
  sourceVersionId: int("sourceVersionId"),
  outcome: mysqlEnum("outcome", ["WIN", "LOSS", "INVALIDATED"]).notNull(),
  status: mysqlEnum("status", ["PROPOSED", "VALIDATING", "ACCEPTED", "REJECTED"]).default("PROPOSED").notNull(),
  observation: mediumtext("observation").notNull(),
  lessonJson: mediumtext("lessonJson").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  validatedAt: timestamp("validatedAt"),
});

export const entryLocatorStates = mysqlTable("entry_locator_states", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  asset: varchar("asset", { length: 32 }).notNull(),
  timeframe: varchar("timeframe", { length: 16 }).notNull(),
  status: mysqlEnum("status", ["WAITING", "READY", "EMITTED"]).default("WAITING").notNull(),
  snapshotCount: int("snapshotCount").default(0).notNull(),
  lastSnapshotAt: timestamp("lastSnapshotAt"),
  lastDirection: mysqlEnum("lastDirection", ["BUY", "SELL"]),
  lastConfidence: decimal("lastConfidence", { precision: 5, scale: 2 }),
  lastConfluence: decimal("lastConfluence", { precision: 5, scale: 2 }),
  evidenceJson: mediumtext("evidenceJson"),
  conflictJson: mediumtext("conflictJson"),
  stateJson: mediumtext("stateJson"),
  lastEmittedAt: timestamp("lastEmittedAt"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const v5ZoneHistory = mysqlTable("v5_zone_history", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  asset: varchar("asset", { length: 32 }).notNull(),
  timeframe: varchar("timeframe", { length: 16 }).notNull(),
  zoneKey: varchar("zoneKey", { length: 255 }).notNull(),
  zoneKind: mysqlEnum("zoneKind", ["SUPPLY", "DEMAND"]).notNull(),
  lower: decimal("lower", { precision: 24, scale: 10 }).notNull(),
  upper: decimal("upper", { precision: 24, scale: 10 }).notNull(),
  reactions: int("reactions").default(0).notNull(),
  displacement: decimal("displacement", { precision: 24, scale: 10 }).default("0").notNull(),
  fresh: boolean("fresh").default(true).notNull(),
  weakFor: varchar("weakFor", { length: 32 }).default("").notNull(),
  lifecycle: mysqlEnum("lifecycle", ["ACTIVE", "WEAKENED", "INVALIDATED"]).default("ACTIVE").notNull(),
  observationCount: int("observationCount").default(1).notNull(),
  retestCount: int("retestCount").default(0).notNull(),
  firstSeenAt: timestamp("firstSeenAt").defaultNow().notNull(),
  lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
  lastCandleAt: timestamp("lastCandleAt"),
  lastRetestedAt: timestamp("lastRetestedAt"),
  evidenceJson: mediumtext("evidenceJson").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  zoneIdentityUnique: unique("v5_zone_history_identity_unique").on(table.userId, table.asset, table.timeframe, table.zoneKey),
  assetTimeframeIdx: index("v5_zone_history_asset_timeframe_idx").on(table.userId, table.asset, table.timeframe),
  lifecycleIdx: index("v5_zone_history_lifecycle_idx").on(table.userId, table.lifecycle),
}));

export const entryForgerStates = mysqlTable("entry_forger_states", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  asset: varchar("asset", { length: 32 }).notNull(),
  timeframe: varchar("timeframe", { length: 16 }).notNull(),
  status: mysqlEnum("status", ["WAITING", "READY", "EMITTED", "REJECTED"]).default("WAITING").notNull(),
  snapshotCount: int("snapshotCount").default(0).notNull(),
  lastSnapshotAt: timestamp("lastSnapshotAt"),
  lastDirection: mysqlEnum("lastDirection", ["BUY", "SELL"]),
  lastConfidence: decimal("lastConfidence", { precision: 5, scale: 2 }),
  lastConfluence: decimal("lastConfluence", { precision: 5, scale: 2 }),
  reason: text("reason"),
  targetBoundary: decimal("targetBoundary", { precision: 24, scale: 10 }),
  targetDistance: decimal("targetDistance", { precision: 24, scale: 10 }),
  riskReward: decimal("riskReward", { precision: 5, scale: 2 }),
  stateJson: mediumtext("stateJson"),
  lastEmittedAt: timestamp("lastEmittedAt"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  userAssetTimeframeUnique: unique("entry_forger_states_user_asset_timeframe_unique").on(table.userId, table.asset, table.timeframe),
  updatedAtIdx: index("entry_forger_states_updated_at_idx").on(table.updatedAt),
}));
export const appSettings = mysqlTable("app_settings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  onboardingComplete: boolean("onboardingComplete").default(false).notNull(),
  scannerEnabled: boolean("scannerEnabled").default(true).notNull(),
  setupCooldownMinutes: int("setupCooldownMinutes").default(30).notNull(),
  strategyEngineStatus: mysqlEnum("strategyEngineStatus", ["AVAILABLE", "UNAVAILABLE", "NOT_RUN"]).default("NOT_RUN").notNull(),
  strategyEngineLastRunAt: timestamp("strategyEngineLastRunAt"),
  strategyEngineLastError: text("strategyEngineLastError"),
  strategyEngineTotalSnapshots: int("strategyEngineTotalSnapshots").default(0).notNull(),
  strategyEngineCompleteResponses: int("strategyEngineCompleteResponses").default(0).notNull(),
  strategyEngineRetryCount: int("strategyEngineRetryCount").default(0).notNull(),
  strategyEngineUnavailableCycles: int("strategyEngineUnavailableCycles").default(0).notNull(),
  scheduleCronTaskUid: varchar("scheduleCronTaskUid", { length: 65 }),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const scannerRunLedger = mysqlTable("scanner_run_ledger", {
  id: int("id").autoincrement().primaryKey(),
  taskUid: varchar("taskUid", { length: 65 }).notNull(),
  runKey: varchar("runKey", { length: 128 }).notNull(),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  finishedAt: timestamp("finishedAt"),
  status: mysqlEnum("status", ["RUNNING", "SUCCEEDED", "FAILED"]).default("RUNNING").notNull(),
  usersProcessed: int("usersProcessed").default(0).notNull(),
  createdSignals: int("createdSignals").default(0).notNull(),
  trackedSignals: int("trackedSignals").default(0).notNull(),
  adjustments: int("adjustments").default(0).notNull(),
  /** Number of overlapping callbacks suppressed by this shared five-minute run bucket. */
  duplicateCallbacks: int("duplicateCallbacks").default(0).notNull(),
  lastDuplicateAt: timestamp("lastDuplicateAt"),
  marketData: mysqlEnum("marketData", ["available", "unavailable", "not-run"]).default("not-run").notNull(),
  error: text("error"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  runKeyUnique: unique("scanner_run_ledger_run_key_unique").on(table.runKey),
  taskUidIdx: index("scanner_run_ledger_task_uid_idx").on(table.taskUid),
  startedAtIdx: index("scanner_run_ledger_started_at_idx").on(table.startedAt),
}));

export type ScannerRunLedger = typeof scannerRunLedger.$inferSelect;

export const ownerAlertLedger = mysqlTable("owner_alert_ledger", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  alertType: varchar("alertType", { length: 64 }).notNull(),
  dedupeKey: varchar("dedupeKey", { length: 255 }).notNull().unique(),
  title: varchar("title", { length: 255 }).notNull(),
  content: text("content").notNull(),
  notifiedAt: timestamp("notifiedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({ userAlertIdx: index("owner_alert_user_type_idx").on(table.userId, table.alertType, table.createdAt) }));
export type OwnerAlertLedger = typeof ownerAlertLedger.$inferSelect;

export type StrategyRule = typeof strategyRules.$inferSelect;
export type GeneratedSignal = typeof generatedSignals.$inferSelect;
export type AuditTrade = typeof auditTrades.$inferSelect;
export type TelegramDelivery = typeof telegramDeliveries.$inferSelect;
export type PaperTradeAdjustment = typeof paperTradeAdjustments.$inferSelect;
export type StrategyDecision = typeof strategyDecisionLedger.$inferSelect;
export type CooldownChange = typeof cooldownChangeLog.$inferSelect;
export type StrategyIntelligenceVersion = typeof strategyIntelligenceVersions.$inferSelect;
export type StrategyIntelligenceComponent = typeof strategyIntelligenceComponents.$inferSelect;
export type StrategyLesson = typeof strategyLessons.$inferSelect;
export type EntryLocatorState = typeof entryLocatorStates.$inferSelect;
