import type { Message } from "@/components/AIChatBox";
import { CallbackStatusCard } from "@/components/CallbackStatusCard";
import { WinningRateTelemetry } from "@/components/WinningRateTelemetry";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useSidebar } from "@/components/ui/sidebar";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { formatChatError } from "@/lib/chat-errors";
import {
  BookOpen,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  FileText,
  Gauge,
  Loader2,
  LockKeyhole,
  MessageSquareText,
  Paperclip,
  PanelLeft,
  Radar,
  RefreshCw,
  ShieldCheck,
  Download,
  Trash2,
  Sparkles,
  TrendingDown,
  TrendingUp,
  UploadCloud,
  Zap,
} from "lucide-react";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { AIChatBox } from "@/components/AIChatBox";
import { useLocation } from "wouter";
import { toast } from "sonner";

const LIVE_QUERY_OPTIONS = {
  refetchInterval: 60_000,
  refetchOnWindowFocus: true,
};

const WATCHLIST = [
  { symbol: "EUR/USD", label: "Euro / Dollar" },
  { symbol: "XAU/USD", label: "Gold Spot" },
  { symbol: "GBP/USD", label: "Pound / Dollar" },
  { symbol: "BTC/USD", label: "Bitcoin" },
];

function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          {eyebrow}
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-[-0.04em] text-foreground md:text-4xl">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const good =
    status === "WIN" ||
    status === "APPROVED" ||
    status === "DELIVERED" ||
    status === "AVAILABLE";
  const bad = status === "LOSS" || status === "DENIED" || status === "FAILED";
  return (
    <Badge
      className={
        good
          ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600"
          : bad
            ? "border-rose-500/20 bg-rose-500/10 text-rose-600"
            : "border-amber-500/20 bg-amber-500/10 text-amber-600"
      }
    >
      {status}
    </Badge>
  );
}
function formatDateTime(value: Date | string | null | undefined) {
  return value
    ? new Date(value).toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
}
function scannerFreshness(value: Date | string | null | undefined) {
  if (!value) return { label: "No successful cycle", tone: "text-amber-700", detail: "Waiting for the first successful market-data cycle." };
  const ageMinutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (ageMinutes <= 7) return { label: `Fresh · ${ageMinutes}m ago`, tone: "text-emerald-700", detail: `Latest successful cycle finished ${formatDateTime(value)}.` };
  if (ageMinutes <= 15) return { label: `Recent · ${ageMinutes}m ago`, tone: "text-emerald-700", detail: `Latest successful cycle finished ${formatDateTime(value)}.` };
  if (ageMinutes <= 30) return { label: `Aging · ${ageMinutes}m ago`, tone: "text-amber-700", detail: `Latest successful cycle finished ${formatDateTime(value)}.` };
  return { label: `Stale · ${ageMinutes}m ago`, tone: "text-rose-700", detail: `Latest successful cycle finished ${formatDateTime(value)}.` };
}

function riskRewardLabel(signal: {
  direction: string;
  entry: unknown;
  stopLoss: unknown;
  takeProfit: unknown;
  riskReward?: unknown;
}) {
  const entry = Number(signal.entry);
  const stopLoss = Number(signal.stopLoss);
  const takeProfit = Number(signal.takeProfit);
  const risk = Math.abs(stopLoss - entry);
  const reward =
    signal.direction === "BUY" ? takeProfit - entry : entry - takeProfit;
  if (![risk, reward].every(Number.isFinite) || risk <= 0 || reward <= 0)
    return "RR unavailable";
  const actual = Number((reward / risk).toFixed(2));
  const stored = Number(signal.riskReward);
  if (
    Math.abs(actual - 2) <= 0.01 &&
    (!Number.isFinite(stored) || Math.abs(stored - actual) <= 0.01)
  )
    return "1:2 verified";
  return `1:${actual.toFixed(2)}${Number.isFinite(stored) ? ` · stored 1:${stored.toFixed(2)}` : ""}`;
}

function RulesUpload({ compact = false }: { compact?: boolean }) {
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const ingest = trpc.rules.ingest.useMutation({
    onSuccess: () => {
      toast.success("Strategy rules ingested");
      setTitle("");
    },
    onError: e => toast.error(e.message),
  });
  const handleFile = async (file: File) => {
    const ext = file.name.toLowerCase().endsWith(".pdf")
      ? "pdf"
      : file.name.toLowerCase().endsWith(".docx")
        ? "docx"
        : "text";
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    bytes.forEach(b => {
      binary += String.fromCharCode(b);
    });
    ingest.mutate({
      fileName: file.name,
      mimeType: file.type || "text/plain",
      sourceType: ext,
      title: title || file.name.replace(/\.[^/.]+$/, ""),
      contentBase64: btoa(binary),
    });
  };
  return (
    <Card
      className={
        compact
          ? "border-dashed bg-primary/[0.035]"
          : "border-dashed border-primary/30 bg-primary/[0.035]"
      }
    >
      <CardContent className={compact ? "p-4" : "p-6"}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
              <UploadCloud className="h-5 w-5" />
            </div>
            <div>
              <p className="font-medium">
                {compact
                  ? "Add another rule set"
                  : "Import your trading playbook"}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                PDF, Word, or plain text. The guard will use this as its
                operating memory.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Rule set title"
              className="h-9 w-44 bg-background"
            />
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.docx,.txt,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={e =>
                e.target.files?.[0] && handleFile(e.target.files[0])
              }
            />
            <Button
              onClick={() => inputRef.current?.click()}
              disabled={ingest.isPending}
              className="h-9"
            >
              {ingest.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Paperclip className="mr-2 h-4 w-4" />
              )}
              Choose file
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DataError({ text }: { text: string }) {
  return (
    <div className="mb-5 flex items-start gap-3 rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-700">
      <TrendingDown className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{text}</span>
    </div>
  );
}
function ReplacementStatsCard() {
  const stats = trpc.intelligence.replacementOutcomeStats.useQuery(
    undefined,
    LIVE_QUERY_OPTIONS
  );
  const validation = stats.data?.validation;
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="font-display text-xl">
          Hierarchical workflow paper validation
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Hierarchical-workflow outcome performance, confidence calibration, and source-linked
          market regimes.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <SummaryStat
            label="Workflow outcomes"
            value={stats.data?.total ?? 0}
            tone="neutral"
          />
          <SummaryStat
            label="Resolved"
            value={validation?.resolved ?? 0}
            tone="neutral"
          />
          <SummaryStat label="Wins" value={validation?.wins ?? 0} tone="good" />
          <SummaryStat
            label="Losses"
            value={validation?.losses ?? 0}
            tone="bad"
          />
        </div>
        <div className="rounded-xl border bg-muted/20 p-3 text-sm">
          <p className="font-medium">
            First-50 review:{" "}
            {validation?.reviewStatus === "READY_FOR_REVIEW"
              ? "Ready for review"
              : `Collecting evidence (${validation?.resolved ?? 0}/${validation?.reviewThreshold ?? 50} resolved)`}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Observed win rate:{" "}
            {validation?.winRate == null ? "—" : `${validation.winRate}%`}.
            Lesson promotion remains blocked until the first{" "}
            {validation?.reviewThreshold ?? 50} resolved v3 outcomes are
            reviewed.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Top components
            </p>
            <div className="space-y-2">
              {(stats.data?.components ?? []).slice(0, 5).map(item => (
                <div
                  key={item.key}
                  className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs"
                >
                  <span className="max-w-[70%] truncate">{item.key}</span>
                  <span>
                    {item.winRate == null ? "—" : `${item.winRate}%`} ·{" "}
                    {item.total}
                  </span>
                </div>
              ))}
              {!stats.data?.components?.length && (
                <p className="text-xs text-muted-foreground">
                  No hierarchical-workflow outcomes recorded yet.
                </p>
              )}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Market regimes
            </p>
            <div className="space-y-2">
              {(stats.data?.regimes ?? []).slice(0, 5).map(item => (
                <div
                  key={item.key}
                  className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs"
                >
                  <span className="max-w-[68%] truncate">{item.key}</span>
                  <span>
                    {item.winRate == null ? "—" : `${item.winRate}%`} ·{" "}
                    {item.total}
                  </span>
                </div>
              ))}
              {!stats.data?.regimes?.length && (
                <p className="text-xs text-muted-foreground">
                  No v3 regimes recorded yet.
                </p>
              )}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Confidence bands
            </p>
            <div className="space-y-2">
              {(stats.data?.confidenceBands ?? []).map(item => (
                <div
                  key={item.key}
                  className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs"
                >
                  <span>{item.key}%</span>
                  <span>
                    {item.winRate == null ? "—" : `${item.winRate}%`} ·{" "}
                    {item.total}
                  </span>
                </div>
              ))}
              {!stats.data?.confidenceBands?.length && (
                <p className="text-xs text-muted-foreground">
                  Calibration begins with hierarchical-workflow outcomes.
                </p>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function V5MonitoringCard() {
  const query = trpc.intelligence.v5Monitoring.useQuery(
    undefined,
    LIVE_QUERY_OPTIONS
  );
  const dimensions = Object.entries(query.data ?? {}) as Array<
    [
      string,
      Array<{
        key: string;
        generated: number;
        resolved: number;
        wins: number;
        losses: number;
        winRate: number | null;
      }>,
    ]
  >;
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="font-display text-xl">
          Active hierarchical outcome monitor
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Resolved paper outcomes grouped by the active model’s asset,
          timeframe, direction, event-risk state, and structural target
          geometry.
        </p>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {dimensions.map(([dimension, rows]) => (
          <div key={dimension} className="rounded-xl border bg-muted/20 p-3">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {dimension === "eventRisk"
                ? "Event risk"
                : dimension === "geometry"
                  ? "Geometry"
                  : dimension}
            </p>
            <div className="space-y-2">
              {rows.length ? (
                rows.map(row => (
                  <div
                    key={row.key}
                    className="rounded-lg border bg-background px-3 py-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{row.key}</span>
                      <span className="shrink-0">
                        {row.winRate == null ? "—" : `${row.winRate}%`}
                      </span>
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      {row.generated} generated · {row.resolved} resolved ·{" "}
                      {row.wins}W / {row.losses}L
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">
                  No v5 signals recorded yet.
                </p>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function Onboarding() {
  const rules = trpc.rules.list.useQuery();
  if (rules.isError)
    return (
      <div className="mx-auto max-w-xl px-6 py-16">
        <DataError text="Strategy memory could not be loaded. Refresh the page before uploading rules." />
      </div>
    );
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl items-center justify-center px-6 py-12">
      <div className="grid w-full gap-8 lg:grid-cols-[.9fr_1.1fr] lg:items-center">
        <div>
          <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">
            TradingGuardAI · Setup
          </div>
          <h1 className="font-display text-4xl font-semibold leading-tight tracking-[-0.05em] md:text-5xl">
            Start with your rules.
            <br />
            <span className="text-primary">Trade with a guard.</span>
          </h1>
          <p className="mt-5 max-w-md text-sm leading-7 text-muted-foreground">
            Before the assistant audits a single idea or scans a market, give it
            the strategy playbook it must follow. Your rules remain the source
            of truth.
          </p>
          <div className="mt-8 space-y-3">
            <Protocol
              icon={BookOpen}
              title="Ingest your playbook"
              text="Import PDF, Word, or plain text strategy rules."
            />
            <Protocol
              icon={ShieldCheck}
              title="Keep decisions grounded"
              text="Audits and strategy-engine judgments reference your rule memory."
            />
            <Protocol
              icon={LockKeyhole}
              title="Stay in control"
              text="The app analyzes and alerts; it never places a trade."
            />
          </div>
        </div>
        <div>
          <Card className="border-primary/15 shadow-xl shadow-primary/5">
            <CardHeader className="border-b bg-muted/20 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="font-display text-xl">
                    Load your strategy rules
                  </CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Required before autonomous features activate
                  </p>
                </div>
                <Badge variant="outline">Step 1 of 1</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-5 p-6">
              <RulesUpload />
              <div className="rounded-xl border bg-muted/30 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Accepted content
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Entry conditions, invalidation rules, risk limits, timeframes,
                  session filters, and any mistakes the guard must avoid.
                </p>
              </div>
              {rules.data?.length ? (
                <Button
                  className="w-full"
                  onClick={() => window.location.assign("/")}
                >
                  Continue to control room{" "}
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              ) : (
                <p className="text-center text-xs text-muted-foreground">
                  Upload at least one rule set to continue.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Overview() {
  const rules = trpc.rules.list.useQuery();
  const marketPulse = trpc.scanner.marketPulse.useQuery(
    undefined,
    LIVE_QUERY_OPTIONS
  );
  const signals = trpc.signals.list.useQuery(undefined, LIVE_QUERY_OPTIONS);
  const audits = trpc.signals.audits.useQuery(undefined, LIVE_QUERY_OPTIONS);
  const judgment = trpc.scanner.summary.useQuery(undefined, LIVE_QUERY_OPTIONS);
  const pending = signals.data?.filter(s => s.status === "PENDING").length ?? 0;
  const wins = signals.data?.filter(s => s.status === "WIN").length ?? 0;
  return (
    <>
      {(rules.isError ||
        marketPulse.isError ||
        signals.isError ||
        audits.isError) && (
        <DataError text="Some control-room data is unavailable. Refresh after the connected provider recovers." />
      )}
      <PageHeading
        eyebrow="Control room"
        title="Stay disciplined in every market."
        description="A calm, rules-first command center for auditing ideas, monitoring live signals, and learning from every outcome."
        action={
          <Button
            onClick={() => window.location.assign("/chat-audit")}
            className="h-10"
          >
            <MessageSquareText className="mr-2 h-4 w-4" />
            Audit a trade
          </Button>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Metric
          label="Rules ingested"
          value={rules.data?.length ?? 0}
          icon={BookOpen}
          detail="Your operating memory"
        />
        <Metric
          label="Open signals"
          value={pending}
          icon={Radar}
          detail="Being tracked live"
        />
        <Metric
          label="Win rate"
          value={
            signals.data?.length
              ? `${Math.round((wins / signals.data.length) * 100)}%`
              : "—"
          }
          icon={TrendingUp}
          detail="From generated signals"
        />
        <Metric
          label="Audits completed"
          value={audits.data?.length ?? 0}
          icon={ShieldCheck}
          detail="With live conditions"
        />
        <Metric
          label="Strategy judgments"
          value={judgment.data?.total ?? 0}
          icon={Gauge}
          detail="All engine outcomes"
        />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_.65fr]">
        <Card className="overflow-hidden">
          <CardHeader className="border-b bg-muted/20">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="font-display text-xl">
                  Market pulse
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Snapshot watchlist · refreshed by the market-data collector
                </p>
              </div>
              <Badge
                variant="outline"
                className={`gap-1.5 ${marketPulse.isError || !marketPulse.data?.length ? "border-amber-500/30 text-amber-700" : "border-emerald-500/30 text-emerald-600"}`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${marketPulse.isError || !marketPulse.data?.length ? "bg-amber-500" : "bg-emerald-500"}`}
                />
                {marketPulse.isLoading
                  ? "Syncing"
                  : marketPulse.isError
                    ? "Unavailable"
                    : "Live feed"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
            {WATCHLIST.map(item => {
              const pulse = marketPulse.data?.find(
                row => row.asset === item.symbol
              );
              const hasPrice = pulse?.price != null;
              return (
                <div
                  key={item.symbol}
                  className="rounded-2xl border bg-background p-4"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold tracking-tight">
                        {item.symbol}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {item.label}
                      </p>
                    </div>
                    <span
                      className={
                        pulse?.trend === "UP"
                          ? "text-emerald-600"
                          : pulse?.trend === "DOWN"
                            ? "text-rose-600"
                            : "text-muted-foreground"
                      }
                    >
                      {pulse?.trend === "UP" ? (
                        <TrendingUp className="h-4 w-4" />
                      ) : pulse?.trend === "DOWN" ? (
                        <TrendingDown className="h-4 w-4" />
                      ) : (
                        <Gauge className="h-4 w-4" />
                      )}
                    </span>
                  </div>
                  <div className="mt-5 flex items-end justify-between gap-3">
                    <span className="font-display text-2xl font-semibold">
                      {hasPrice
                        ? pulse.price!.toLocaleString(undefined, {
                            maximumFractionDigits: 8,
                          })
                        : "—"}
                    </span>
                    <span className="text-right text-[11px] leading-4 text-muted-foreground">
                      {pulse
                        ? `Saved ${formatDateTime(pulse.savedAt)}`
                        : marketPulse.isLoading
                          ? "Awaiting scanner"
                          : "No scanner data"}
                    </span>
                  </div>
                  {pulse?.candleTime && (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Last candle {pulse.candleTime} · {pulse.timeframe}
                    </p>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_.9fr]">
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-xl">
              Strategy-judgment outcomes
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              The strategy-rules algorithm’s recorded judgment states.
            </p>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryStat
              label="Approved"
              value={judgment.data?.approved ?? 0}
              tone="good"
            />
            <SummaryStat
              label="Denied"
              value={judgment.data?.denied ?? 0}
              tone="bad"
            />
            <SummaryStat
              label="Skipped"
              value={judgment.data?.skipped ?? 0}
              tone="neutral"
            />
            <SummaryStat
              label="Unavailable"
              value={judgment.data?.unavailable ?? 0}
              tone="bad"
            />
          </CardContent>
        </Card>
      </div>
      <EntryLocatorCard />
      <div className="mt-6">
        <RulesUpload compact />
      </div>
    </>
  );
}
function EntryLocatorCard() {
  const query = trpc.intelligence.entryLocator.useQuery(
    undefined,
    LIVE_QUERY_OPTIONS
  );
  const cadence = trpc.scanner.cadence.useQuery(undefined, LIVE_QUERY_OPTIONS);
  const states = query.data ?? [];
  const latestScannerAttempt = cadence.data?.lastRunAt;
  const latestSnapshotAt = states.reduce<Date | string | null>((latest, state) => {
    if (!state.updatedAt) return latest;
    if (!latest) return state.updatedAt;
    return new Date(state.updatedAt).getTime() > new Date(latest).getTime() ? state.updatedAt : latest;
  }, null);
  const scannerAttemptIsNewer = Boolean(
    latestScannerAttempt &&
    (!latestSnapshotAt || new Date(latestScannerAttempt).getTime() > new Date(latestSnapshotAt).getTime())
  );
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="font-display text-xl">
          V5 hierarchy execution states
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          V5 evaluates each scanner snapshot through 4H bias → 1H context →
          independent 15M and 5M execution. Entry Locator is the final
          execution-readiness gate; these states show whether v5 has a
          qualified plan ready to emit.
        </p>
        {latestScannerAttempt ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Latest scanner cycle: <span className="font-medium text-foreground">{formatDateTime(latestScannerAttempt)}</span>
            {cadence.data?.latestProviderIssue
              ? ` · ${cadence.data.latestProviderIssue.provider} data unavailable (${cadence.data.latestProviderIssue.statusCode ?? "provider error"})`
              : " · cycle recorded"}
          </p>
        ) : null}
        <p className="mt-1 text-xs text-muted-foreground">
          Latest complete market-data cycle for 15M + 1H + 4H: <span className="font-medium text-foreground">{formatDateTime(cadence.data?.latestSuccessfulAt)}</span>
        </p>
      </CardHeader>
      <CardContent>
        {states.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {states.map(state => (
              <div
                key={`${state.asset}-${state.timeframe}`}
                className="rounded-xl border bg-muted/20 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{state.asset}</p>
                    <p className="text-xs text-muted-foreground">
                      {state.timeframe}
                    </p>
                  </div>
                  <StatusPill status={state.status} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <p className="text-muted-foreground">{state.timeframe === "1H" || state.timeframe === "4H" ? "V5 context refreshes" : "V5 snapshots evaluated"}</p>
                    <p className="mt-1 font-semibold">{state.snapshotCount}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{state.timeframe === "1H" || state.timeframe === "4H" ? "Role" : "Last direction"}</p>
                    <p className="mt-1 font-semibold">
                      {state.timeframe === "1H" || state.timeframe === "4H" ? "CONTEXT ONLY" : state.lastDirection ?? "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Confidence</p>
                    <p className="mt-1 font-semibold">
                      {state.lastConfidence == null
                        ? "—"
                        : `${state.lastConfidence}%`}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Confluence</p>
                    <p className="mt-1 font-semibold">
                      {state.lastConfluence == null
                        ? "—"
                        : `${state.lastConfluence}%`}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  {state.timeframe === "1H" || state.timeframe === "4H"
                    ? `${state.timeframe} context refreshed for the v5 hierarchy; this timeframe is not eligible for signal emission.`
                    : state.stateJson
                    ? (() => {
                        try {
                          return (
                            JSON.parse(state.stateJson).waitReason ??
                            "State recorded."
                          );
                        } catch {
                          return "State recorded.";
                        }
                      })()
                    : "State recorded."}
                </p>
                <div className="mt-3 flex items-center justify-between gap-2 border-t pt-2 text-[11px]">
                  <span className="text-muted-foreground">{state.timeframe === "1H" || state.timeframe === "4H" ? "Signal delivery" : "Telegram delivery"}</span>
                  <span className={
                    state.orphanedEmission
                      ? "font-semibold text-amber-700"
                      : state.telegramDelivery?.status === "DELIVERED"
                        ? "font-semibold text-emerald-700"
                        : state.telegramDelivery?.status === "FAILED"
                          ? "font-semibold text-rose-700"
                          : "font-semibold text-muted-foreground"
                  }>
                    {state.timeframe === "1H" || state.timeframe === "4H"
                      ? "CONTEXT ONLY"
                      : state.orphanedEmission
                        ? "ORPHANED STATE"
                        : state.telegramDelivery?.status ?? (state.matchingSignal ? "NOT RECORDED" : "NO SIGNAL")}
                  </span>
                </div>
                {state.orphanedEmission ? (
                  <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] leading-4 text-amber-800">
                    No matching unresolved v5 signal exists; this state is not an active trade lock.
                  </p>
                ) : state.telegramDelivery ? (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {state.telegramDelivery.status === "DELIVERED"
                      ? `Delivered ${formatDateTime(state.telegramDelivery.deliveredAt ?? state.telegramDelivery.createdAt)}`
                      : state.telegramDelivery.error ?? "Telegram delivery failed."}
                  </p>
                ) : state.matchingSignal ? (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Signal exists, but no Telegram delivery record is available.
                  </p>
                ) : null}
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {state.timeframe === "1H" || state.timeframe === "4H" ? `Last ${state.timeframe} context refresh` : "Last v5 state update"} {formatDateTime(state.updatedAt)}
                </p>
                {scannerAttemptIsNewer ? (
                  <p className="mt-1 text-[11px] leading-4 text-amber-700">
                    Latest scanner cycle {formatDateTime(latestScannerAttempt)} did not write a new v5 snapshot
                    {cadence.data?.latestProviderIssue ? " because provider data was unavailable." : "."}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
            No locator state has been recorded yet. The next scanner cycle will
            begin accumulating snapshots.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
function Metric({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: React.ElementType;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">
            {label}
          </span>
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <p className="mt-4 font-display text-3xl font-semibold tracking-[-0.04em]">
          {value}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}
function HealthRow({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-2 flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold">{value}%</span>
      </div>
      <Progress value={value} className="h-1.5" />
    </div>
  );
}
function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: "good" | "bad" | "neutral";
}) {
  return (
    <div
      className={`rounded-xl border p-3 ${tone === "good" ? "border-emerald-500/20 bg-emerald-500/5" : tone === "bad" ? "border-rose-500/20 bg-rose-500/5" : "bg-muted/30"}`}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-2 font-display text-2xl font-semibold">{value}</p>
    </div>
  );
}

function RulesPage() {
  const rules = trpc.rules.list.useQuery();
  return (
    <>
      {rules.isError && (
        <DataError text="Strategy rules could not be loaded. Try refreshing the rule memory." />
      )}
      <PageHeading
        eyebrow="Operating memory"
        title="Strategy rules"
        description="Keep the guard aligned with your actual playbook. Every imported rule set becomes searchable context for audits and strategy-engine judgments."
        action={
          <Button variant="outline" onClick={() => rules.refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        }
      />
      <RulesUpload />
      <div className="mt-6 space-y-3">
        {rules.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading rule memory…
          </div>
        ) : rules.data?.length ? (
          rules.data.map(rule => (
            <Card key={rule.id}>
              <CardContent className="flex items-start justify-between gap-4 p-5">
                <div className="flex min-w-0 gap-3">
                  <div className="rounded-xl bg-muted p-2.5">
                    <FileText className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{rule.title}</p>
                      <Badge
                        variant="outline"
                        className="text-[10px] uppercase"
                      >
                        {rule.sourceType}
                      </Badge>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">
                      {rule.content}
                    </p>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Imported {new Date(rule.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
              </CardContent>
            </Card>
          ))
        ) : (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center p-12 text-center">
              <BookOpen className="h-8 w-8 text-primary/50" />
              <p className="mt-4 font-medium">No rules ingested yet</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Upload your first strategy playbook to activate rules-first
                audits and scanning.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}

function ChatAudit({ assistant = "WHITE" }: { assistant?: "WHITE" | "CHERRY" } = {}) {
  const isCherry = assistant === "CHERRY";
  const history = trpc.audit.history.useQuery({ channel: assistant }, LIVE_QUERY_OPTIONS);
  const [mode, setMode] = useState<"ASK" | "AUDIT">(isCherry ? "AUDIT" : "ASK");
  const [messages, setMessages] = useState<Message[]>([]);
  const historical = (history.data ?? [])
    .slice()
    .reverse()
    .map(m => ({ role: m.role, content: m.content }) as Message);
  const combined = useMemo(
    () => (historical.length ? historical : messages),
    [historical.length, historical.map(m => m.content).join("|")]
  );
  const audit = trpc.audit.run.useMutation({
    onSuccess: result => {
      setMessages(prev => [...prev, result]);
      history.refetch();
    },
    onError: e => toast.error(formatChatError(e, "Cherry AI")),
  });
  const conversation = trpc.audit.conversation.useMutation({
    onSuccess: result => {
      setMessages(prev => [...prev, result]);
      history.refetch();
    },
    onError: e => toast.error(formatChatError(e, "White AI")),
  });
  const clearConversation = trpc.audit.clearConversation.useMutation({
    onSuccess: () => {
      setMessages([]);
      history.refetch();
      toast.success("Chat conversation cleared");
    },
    onError: e => toast.error(e.message),
  });
  const isPending =
    audit.isPending || conversation.isPending || clearConversation.isPending;
  const handleMessage = (signal: string) => {
    const nextMessages = [
      ...combined,
      { role: "user" as const, content: signal },
    ];
    setMessages(nextMessages);
    if (isCherry || mode === "AUDIT")
      audit.mutate({
        signal: signal.length >= 8 ? signal : `Audit: ${signal}`,
      });
    else
      conversation.mutate({
        channel: "WHITE",
        messages: nextMessages
          .slice(-24)
          .map(message => ({
            role:
              message.role === "assistant"
                ? ("assistant" as const)
                : ("user" as const),
            content: message.content,
          })),
      });
  };
  const exportConversation = () => {
    const text = combined
      .map(message => `${message.role.toUpperCase()}\n${message.content}`)
      .join("\n\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `trading-guard-chat-${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const { toggleSidebar } = useSidebar();
  const prompts = isCherry
    ? [
        "Audit EUR/USD BUY on 15MIN with 1:2 risk/reward",
        "Audit XAU/USD SELL on 5MIN and flag any adjustments",
        "Should I take this BTC/USD BUY based on this entry, stop, and target?",
      ]
    : mode === "ASK"
      ? [
          "Why did v5 send or withhold the latest XAU/USD signal?",
          "What are the current XAU/USD zones and scanner status?",
          "Explain how v5 decides confidence, confluence, and geometry.",
        ]
      : [
          "Audit the latest app-generated EUR/USD signal",
          "Explain why this v5 plan was skipped",
          "Audit XAU/USD SELL with 1:2 risk/reward",
        ];
  return (
    <div className="flex h-[100dvh] w-full min-w-0 flex-col overflow-hidden bg-white font-montserrat sm:h-screen sm:border-0">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          {history.isError && <DataError text="Chat history could not be loaded. New conversations remain available after the connection recovers." />}
          <header className="sticky top-0 z-20 flex h-14 min-h-14 shrink-0 items-center justify-between bg-white px-3 sm:h-20 sm:min-h-20 sm:px-6">
            <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
              <Button type="button" variant="ghost" size="icon" onClick={toggleSidebar} aria-label="Open app navigation" title="Open app navigation" className="size-8 shrink-0 text-foreground sm:size-9">
                <PanelLeft className="size-5" />
              </Button>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold tracking-tight sm:text-xl">{isCherry ? "Cherry AI" : "White AI"}</p>
                <p className="truncate text-[8px] font-semibold uppercase tracking-[0.12em] text-foreground sm:text-[10px]">{isCherry ? "INDEPENDENT TRADE REVIEW" : "APP-AWARE CONVERSATIONS"}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 sm:gap-2">
              <Button type="button" variant="ghost" size="icon" onClick={exportConversation} disabled={!combined.length} aria-label="Export conversation" title="Export conversation" className="size-6 rounded-full bg-black text-white hover:bg-black/85 sm:size-9">
                <Download className="size-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon" onClick={() => window.confirm(`Clear this ${isCherry ? "Cherry AI" : "White AI"} conversation? Persisted audit records remain.`) && clearConversation.mutate({ channel: assistant })} disabled={isPending} aria-label="Clear conversation" title="Clear conversation" className="size-6 rounded-full bg-black text-white hover:bg-black/85 sm:size-9">
                <Trash2 className="size-4" />
              </Button>
            </div>
          </header>
          <main className="min-h-0 flex-1 p-0">
            <Suspense fallback={<div className="flex min-h-[50vh] items-center justify-center p-6 text-sm text-muted-foreground">Loading {isCherry ? "Cherry AI" : "White AI"}…</div>}>
              <AIChatBox
                messages={combined}
                onSendMessage={handleMessage}
                isLoading={isPending}
                height="100%"
                className="h-full w-full min-w-0 flex-1 rounded-none border-0 bg-white shadow-none"
                composerHint={isCherry ? "Audit your trade signals with Cherry AI" : "Ask White AI what you want to know about Trading and how trades are taken"}
                placeholder={isCherry ? "Ask Cherry" : "Ask White"}
                emptyStateMessage={isCherry ? "What trade signal\ndo you want to audit?" : "Ask me any\nthing about trading"}
                assistantName={isCherry ? "Cherry AI" : "White AI"}
                assistantTagline={isCherry ? "Independent paper-only trade review" : "Grounded app explanations and forex education"}
                showHeader={false}
                suggestedPrompts={prompts}
              />
            </Suspense>
          </main>
        </section>
    </div>
  );
}
function Protocol({
  icon: Icon,
  title,
  text,
}: {
  icon: React.ElementType;
  title: string;
  text: string;
}) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-0.5 h-4 w-4 text-primary" />
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}

function adjustmentEvidenceSummary(value: string) {
  try {
    const parsed = JSON.parse(value) as {
      opposingIndicators?: unknown[];
      suggestedStopLoss?: number;
    };
    const indicators = Array.isArray(parsed.opposingIndicators)
      ? parsed.opposingIndicators
          .filter((item): item is string => typeof item === "string")
          .slice(0, 3)
          .join("; ")
      : "";
    return { indicators, suggestedStopLoss: parsed.suggestedStopLoss };
  } catch {
    return { indicators: "", suggestedStopLoss: undefined };
  }
}

function AdjustmentHistory() {
  const adjustments = trpc.signals.adjustments.useQuery(
    undefined,
    LIVE_QUERY_OPTIONS
  );
  const [assetFilter, setAssetFilter] = useState("ALL");
  const [actionFilter, setActionFilter] = useState("ALL");
  const filtered = (adjustments.data ?? []).filter(
    item =>
      (assetFilter === "ALL" || item.asset === assetFilter) &&
      (actionFilter === "ALL" || item.action === actionFilter)
  );
  return (
    <Card className="mt-6 border-amber-500/20 bg-amber-500/[0.025]">
      <CardHeader>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="font-display text-xl">
              Paper-trade adjustments
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Automatic contradiction replies linked to unresolved current Entry
              Locator v5 signals.
            </p>
          </div>
          <Badge
            variant="outline"
            className="w-fit border-amber-500/30 text-amber-700"
          >
            {filtered.length}
            {filtered.length !== (adjustments.data?.length ?? 0)
              ? ` / ${adjustments.data?.length ?? 0}`
              : ""}{" "}
            recorded
          </Badge>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="flex flex-1 flex-col gap-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <span>Asset</span>
            <select
              value={assetFilter}
              onChange={event => setAssetFilter(event.target.value)}
              className="h-9 rounded-md border bg-background px-3 text-sm font-normal normal-case tracking-normal text-foreground outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="ALL">All assets</option>
              {Array.from(
                new Set((adjustments.data ?? []).map(item => item.asset))
              ).map(asset => (
                <option key={asset} value={asset}>
                  {asset}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-1 flex-col gap-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <span>Action</span>
            <select
              value={actionFilter}
              onChange={event => setActionFilter(event.target.value)}
              className="h-9 rounded-md border bg-background px-3 text-sm font-normal normal-case tracking-normal text-foreground outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="ALL">All actions</option>
              <option value="REVIEW_DIRECTION">Review direction</option>
              <option value="TIGHTEN_STOP">Tighten stop</option>
              <option value="EXIT_PAPER_SETUP">Exit paper setup</option>
            </select>
          </label>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {adjustments.isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Loading adjustment history…
          </div>
        ) : adjustments.isError ? (
          <div className="p-6">
            <DataError text="Adjustment history could not be loaded. Refresh after the database connection recovers." />
          </div>
        ) : adjustments.data?.length ? (
          filtered.length ? (
            <div className="divide-y">
              {filtered.map(item => {
                const evidence = adjustmentEvidenceSummary(item.evidenceJson);
                return (
                  <div
                    key={item.id}
                    className="grid gap-3 px-5 py-4 lg:grid-cols-[1.2fr_1.1fr_.8fr_1fr]"
                  >
                    <div>
                      <p className="font-medium">
                        {item.originalDirection} → {item.observedDirection}{" "}
                        <span className="text-xs text-muted-foreground">
                          {item.asset} · {item.timeframe}
                        </span>
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Signal #{item.signalId} ·{" "}
                        {formatDateTime(item.createdAt)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Action
                      </p>
                      <p className="mt-1 text-sm">
                        {item.action.replaceAll("_", " ")}
                      </p>
                      {evidence.suggestedStopLoss != null && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Suggested paper stop: {evidence.suggestedStopLoss}
                        </p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Reply
                      </p>
                      <div className="mt-1">
                        <StatusPill
                          status={
                            item.telegramDelivery?.status ?? "NOT RECORDED"
                          }
                        />
                      </div>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {formatDateTime(
                          item.telegramDelivery?.deliveredAt ??
                            item.telegramDelivery?.createdAt
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Evidence
                      </p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {evidence.indicators || item.reason}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No adjustments match the selected filters.
            </div>
          )
        ) : (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No contradiction adjustments have been recorded. The monitor only
            replies when a strong, opposing v5 direction is detected while a
            signal is unresolved.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function upgradeEvidenceSummary(value: string) {
  try {
    const parsed = JSON.parse(value) as {
      improvements?: unknown[];
      previousConfidence?: number;
      newConfidence?: number;
      previousConfluence?: number;
      newConfluence?: number;
    };
    const improvements = Array.isArray(parsed.improvements)
      ? parsed.improvements
          .filter((item): item is string => typeof item === "string")
          .slice(0, 3)
          .join("; ")
      : "";
    return {
      improvements,
      previousConfidence: parsed.previousConfidence,
      newConfidence: parsed.newConfidence,
      previousConfluence: parsed.previousConfluence,
      newConfluence: parsed.newConfluence,
    };
  } catch {
    return {
      improvements: "",
      previousConfidence: undefined,
      newConfidence: undefined,
      previousConfluence: undefined,
      newConfluence: undefined,
    };
  }
}

function UpgradeChainHistory() {
  const chains = trpc.signals.upgradeChains.useQuery(
    undefined,
    LIVE_QUERY_OPTIONS
  );
  const summary = trpc.signals.upgradeSummary.useQuery(
    undefined,
    LIVE_QUERY_OPTIONS
  );
  return (
    <Card className="mt-6 border-primary/20 bg-primary/[0.025]">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="font-display text-xl">
              Stronger setup upgrade chains
            </CardTitle>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              One active paper thesis per asset/timeframe. A materially stronger
              replacement remains linked to the original instead of becoming an
              unrelated duplicate.
            </p>
          </div>
          <Badge
            variant="outline"
            className="w-fit border-primary/30 text-primary"
          >
            {summary.data?.upgradeCount ?? 0} upgrades
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <SummaryStat
            label="Source theses"
            value={summary.data?.sourceTheses ?? 0}
            tone="neutral"
          />
          <SummaryStat
            label="Replacements"
            value={summary.data?.replacementTheses ?? 0}
            tone="good"
          />
          <SummaryStat
            label="Upgrade rate"
            value={
              summary.data?.frequencyPercent == null
                ? "—"
                : `${summary.data.frequencyPercent}%`
            }
            tone="neutral"
          />
        </div>
        {chains.isLoading ? (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            Loading upgrade chains…
          </div>
        ) : chains.isError ? (
          <DataError text="Upgrade-chain history could not be loaded. Refresh after the database connection recovers." />
        ) : chains.data?.length ? (
          <div className="space-y-4">
            {chains.data.map(chain => {
              const evidence = upgradeEvidenceSummary(
                chain.adjustment.evidenceJson
              );
              return (
                <div
                  key={chain.adjustment.id}
                  className="rounded-xl border bg-background p-4"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium">
                        {chain.adjustment.asset} · {chain.adjustment.timeframe}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Upgrade #{chain.adjustment.id} ·{" "}
                        {formatDateTime(chain.adjustment.createdAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatusPill
                        status={
                          chain.original?.status ?? "ORIGINAL UNAVAILABLE"
                        }
                      />
                      <span className="text-xs text-muted-foreground">→</span>
                      <StatusPill
                        status={
                          chain.replacement?.status ?? "REPLACEMENT UNAVAILABLE"
                        }
                      />
                    </div>
                  </div>
                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <div className="rounded-lg border border-dashed p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Original thesis
                      </p>
                      <p className="mt-2 text-sm font-medium">
                        #{chain.original?.id ?? chain.adjustment.signalId} ·{" "}
                        {chain.original?.direction ??
                          chain.adjustment.originalDirection}{" "}
                        · Entry {chain.original?.entry ?? "—"}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        Confidence {chain.original?.confidence ?? "—"}% ·
                        Confluence {chain.original?.confluenceScore ?? "—"}% ·{" "}
                        {chain.original?.status ?? "UNAVAILABLE"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Signal delivery:{" "}
                        {chain.originalDelivery?.status ?? "NOT RECORDED"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-primary/20 bg-primary/[0.035] p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
                        Stronger replacement
                      </p>
                      <p className="mt-2 text-sm font-medium">
                        #
                        {chain.replacement?.id ??
                          chain.adjustment.replacementSignalId ??
                          "—"}{" "}
                        ·{" "}
                        {chain.replacement?.direction ??
                          chain.adjustment.observedDirection}{" "}
                        · Entry {chain.replacement?.entry ?? "—"}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        Confidence{" "}
                        {chain.replacement?.confidence ??
                          evidence.newConfidence ??
                          "—"}
                        % · Confluence{" "}
                        {chain.replacement?.confluenceScore ??
                          evidence.newConfluence ??
                          "—"}
                        % · {chain.replacement?.status ?? "UNAVAILABLE"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Replacement delivery:{" "}
                        {chain.replacementDelivery?.status ?? "NOT RECORDED"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 rounded-lg bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
                    <span className="font-medium text-foreground">
                      Why upgraded:
                    </span>{" "}
                    {evidence.improvements || chain.adjustment.reason}
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Threaded upgrade reply:{" "}
                    {chain.upgradeDelivery?.status ?? "NOT RECORDED"} · Original
                    signal remains preserved for audit history.
                  </p>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            No stronger setup upgrades have been recorded yet. The monitor will
            show the first linked replacement after a materially better
            qualified v5 thesis appears.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function V5SourcePerformanceCard() {
  const [asset, setAsset] = useState("ALL");
  const [timeframe, setTimeframe] = useState<"ALL" | "15MIN" | "5MIN">("ALL");
  const sourceFilters = useMemo(
    () => ({
      asset: asset === "ALL" ? undefined : asset,
      timeframe: timeframe === "ALL" ? undefined : timeframe,
    }),
    [asset, timeframe]
  );
  const query = trpc.intelligence.v5SourceStats.useQuery(sourceFilters, {
    refetchInterval: 60_000,
  });
  const rows = query.data?.sources ?? [];
  const visibleRows = rows;
  return (
    <Card className="mt-6 border-primary/15 bg-primary/[0.025]">
      <CardHeader>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="font-display text-xl">
              V5 source performance
            </CardTitle>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Review v5 paper signals created by the Entry Locator after the
              hierarchy and quality gates pass. Refreshes every minute.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="Filter source performance by asset"
              value={asset}
              onChange={event => setAsset(event.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-xs"
            >
              <option value="ALL">All assets</option>
              {WATCHLIST.map(item => (
                <option key={item.symbol} value={item.symbol}>
                  {item.symbol}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter source performance by timeframe"
              value={timeframe}
              onChange={event =>
                setTimeframe(event.target.value as "ALL" | "15MIN" | "5MIN")
              }
              className="h-9 rounded-md border bg-background px-2 text-xs"
            >
              <option value="ALL">All timeframes</option>
              <option value="15MIN">15MIN</option>
              <option value="5MIN">5MIN</option>
            </select>
            <Badge variant="outline" className="border-primary/30 text-primary">
              UNVALIDATED
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {query.isError ? (
          <DataError text="Source performance could not be loaded. Refresh after the database connection recovers." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {visibleRows.map(row => (
              <div
                key={row.source}
                className="rounded-xl border bg-background p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      "Entry Locator"
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      "V5 structural execution gate"
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      "border-primary/30 text-primary"
                    }
                  >
                    LOCATOR
                  </Badge>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                      Generated
                    </p>
                    <p className="mt-1 text-lg font-semibold">
                      {row.generated}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                      Resolved
                    </p>
                    <p className="mt-1 text-lg font-semibold">{row.resolved}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                      Wins
                    </p>
                    <p className="mt-1 text-lg font-semibold text-emerald-600">
                      {row.wins}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                      Losses
                    </p>
                    <p className="mt-1 text-lg font-semibold text-rose-600">
                      {row.losses}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                      Win rate
                    </p>
                    <p className="mt-1 text-lg font-semibold">
                      {row.winRate == null ? "—" : `${row.winRate}%`}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {!query.isLoading &&
          !query.isError &&
          !visibleRows.some(row => row.generated > 0) && (
            <p className="mt-4 rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">
              No v5 signals match the selected source, asset, or timeframe yet.
              Empty results are shown as zero; no outcome is fabricated.
            </p>
          )}
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          Win rate is wins ÷ resolved outcomes × 100. This is paper-only
          UNVALIDATED evidence; source frequency does not imply profitability or
          guarantee a future result.
        </p>
      </CardContent>
    </Card>
  );
}

function AdaptiveRatioPerformanceCard() {
  const [asset, setAsset] = useState("ALL");
  const [timeframe, setTimeframe] = useState<"ALL" | "15MIN" | "5MIN">("ALL");
  const query = trpc.intelligence.adaptiveRatioStats.useQuery(
    {
      asset: asset === "ALL" ? undefined : asset,
      timeframe: timeframe === "ALL" ? undefined : timeframe,
    },
    { refetchInterval: 60_000 }
  );
  return (
    <Card className="mt-6 border-primary/15 bg-primary/[0.025]">
      <CardHeader>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="font-display text-xl">
              V5 adaptive ratio performance
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Authoritative Entry Locator v5 paper outcomes grouped by selected
              risk/reward ratio. Active v5 selection is limited to 1:3 and 1:2;
              historical 1:1 and 1:1.5 records remain visible for audit.
              Refreshes every minute.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="Filter ratio performance by asset"
              value={asset}
              onChange={event => setAsset(event.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-xs"
            >
              <option value="ALL">All assets</option>
              {WATCHLIST.map(item => (
                <option key={item.symbol} value={item.symbol}>
                  {item.symbol}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter ratio performance by timeframe"
              value={timeframe}
              onChange={event =>
                setTimeframe(event.target.value as "ALL" | "15MIN" | "5MIN")
              }
              className="h-9 rounded-md border bg-background px-2 text-xs"
            >
              <option value="ALL">All timeframes</option>
              <option value="15MIN">15MIN</option>
              <option value="5MIN">5MIN</option>
            </select>
            <Badge variant="outline" className="border-primary/30 text-primary">
              UNVALIDATED
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                <th className="px-3 py-3">Ratio</th>
                <th className="px-3 py-3 text-right">Generated</th>
                <th className="px-3 py-3 text-right">Resolved</th>
                <th className="px-3 py-3 text-right">Wins</th>
                <th className="px-3 py-3 text-right">Losses</th>
                <th className="px-3 py-3 text-right">Win rate</th>
              </tr>
            </thead>
            <tbody>
              {(query.data?.ratios ?? []).map(row => (
                <tr key={row.ratio} className="border-b last:border-0">
                  <td className="px-3 py-3 font-medium">1:{row.ratio}</td>
                  <td className="px-3 py-3 text-right">{row.generated}</td>
                  <td className="px-3 py-3 text-right">{row.resolved}</td>
                  <td className="px-3 py-3 text-right text-emerald-600">
                    {row.wins}
                  </td>
                  <td className="px-3 py-3 text-right text-rose-600">
                    {row.losses}
                  </td>
                  <td className="px-3 py-3 text-right font-semibold">
                    {row.winRate == null ? "—" : `${row.winRate}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          Win rate is wins ÷ resolved outcomes × 100. Empty ratios are shown as
          zero; no outcome is fabricated and no ratio guarantees a profit.
        </p>
      </CardContent>
    </Card>
  );
}

function TradeHistory() {
  const signals = trpc.signals.list.useQuery(undefined, LIVE_QUERY_OPTIONS);
  const audits = trpc.signals.audits.useQuery(undefined, LIVE_QUERY_OPTIONS);
  const summary = trpc.signals.deliverySummary.useQuery(
    undefined,
    LIVE_QUERY_OPTIONS
  );
  const loading = signals.isLoading || audits.isLoading || summary.isLoading;
  const [showStaleOutcomeFailures, setShowStaleOutcomeFailures] =
    useState(false);
  return (
    <>
      {(signals.isError || audits.isError || summary.isError) && (
        <DataError text="History or delivery data could not be loaded. Refresh after the database connection recovers." />
      )}
      <PageHeading
        eyebrow="Evidence log"
        title="Trade history"
        description="Review every generated signal and audited idea with its sent date/time, outcome, and Telegram delivery status."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Generated signals"
          value={summary.data?.generated ?? signals.data?.length ?? 0}
          detail="Scanner records"
          icon={Zap}
        />
        <Metric
          label="Telegram delivered"
          value={summary.data?.signalDelivered ?? 0}
          detail="Confirmed signal messages"
          icon={MessageSquareText}
        />
        <Metric
          label="Telegram failed"
          value={summary.data?.signalFailed ?? 0}
          detail="Recorded delivery failures"
          icon={TrendingDown}
        />
        <Metric
          label="Approved audits"
          value={summary.data?.approvedAudits ?? 0}
          detail="Approved ideas"
          icon={ClipboardCheckIcon}
        />
      </div>
      <Card className="mt-6 border-primary/15 bg-primary/[0.025]">
        <CardHeader>
          <CardTitle className="font-display text-xl">
            Signal reconciliation
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Counts are now separated so a generated signal is not mistaken for a
            delivered Telegram message.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-xl border bg-background p-4">
            <p className="text-xs text-muted-foreground">Generated</p>
            <p className="mt-1 text-2xl font-semibold">
              {summary.data?.generated ?? 0}
            </p>
          </div>
          <div className="rounded-xl border bg-background p-4">
            <p className="text-xs text-muted-foreground">Delivery attempts</p>
            <p className="mt-1 text-2xl font-semibold">
              {summary.data?.signalAttempts ?? 0}
            </p>
          </div>
          <div className="rounded-xl border bg-background p-4">
            <p className="text-xs text-muted-foreground">Signal delivered</p>
            <p className="mt-1 text-2xl font-semibold text-emerald-600">
              {summary.data?.signalDelivered ?? 0}
            </p>
          </div>
          <div className="rounded-xl border bg-background p-4">
            <p className="text-xs text-muted-foreground">Approved delivered</p>
            <p className="mt-1 text-2xl font-semibold text-emerald-600">
              {summary.data?.approvedAuditDelivered ?? 0}
            </p>
          </div>
          <div className="rounded-xl border bg-background p-4">
            <p className="text-xs text-muted-foreground">Approved failed</p>
            <p className="mt-1 text-2xl font-semibold text-rose-600">
              {summary.data?.approvedAuditFailed ?? 0}
            </p>
          </div>
        </CardContent>
      </Card>
      <Card className="mt-6 border-primary/15 bg-primary/[0.025]">
        <CardHeader>
          <CardTitle className="font-display text-xl">
            Telegram delivery health
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Current health uses the last{" "}
            {summary.data?.deliveryHealth?.windowHours ?? 24} hours; historical
            rate-limit failures are shown separately and do not represent
            current delivery availability.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border bg-background p-4">
            <p className="text-xs text-muted-foreground">Recent attempts</p>
            <p className="mt-1 text-2xl font-semibold">
              {summary.data?.deliveryHealth?.recentAttempts ?? 0}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Delivered {summary.data?.deliveryHealth?.recentDelivered ?? 0} ·
              Failed {summary.data?.deliveryHealth?.recentFailed ?? 0}
            </p>
          </div>
          <div className="rounded-xl border bg-background p-4">
            <p className="text-xs text-muted-foreground">
              Current failure rate
            </p>
            <p
              className={`mt-1 text-2xl font-semibold ${(summary.data?.deliveryHealth?.recentFailed ?? 0) > 0 ? "text-rose-600" : "text-emerald-600"}`}
            >
              {summary.data?.deliveryHealth?.recentFailureRate == null
                ? "—"
                : `${summary.data.deliveryHealth.recentFailureRate}%`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Within the current window
            </p>
          </div>
          <div className="rounded-xl border bg-background p-4">
            <p className="text-xs text-muted-foreground">
              Historical rate-limit failures
            </p>
            <p className="mt-1 text-2xl font-semibold text-amber-700">
              {summary.data?.deliveryHealth?.historicalRateLimitFailures ?? 0}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              HTTP 429 or rate-limit errors
            </p>
          </div>
          <div className="rounded-xl border bg-background p-4">
            <p className="text-xs text-muted-foreground">
              Historical other failures
            </p>
            <p className="mt-1 text-2xl font-semibold">
              {summary.data?.deliveryHealth?.historicalOtherFailures ?? 0}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Latest failure{" "}
              {formatDateTime(summary.data?.deliveryHealth?.latestFailureAt)}
            </p>
          </div>
        </CardContent>
      </Card>
      <Card className="mt-6 border-amber-500/20 bg-amber-500/[0.025]">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="font-display text-xl">
                Stale failed outcomes
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Historical failed Telegram outcomes remain available for audit
                but are outside the 20-minute retry window.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowStaleOutcomeFailures(visible => !visible)}
            >
              {showStaleOutcomeFailures ? "Hide review" : "Review records"} (
              {summary.data?.staleOutcomeFailures?.length ?? 0})
            </Button>
          </div>
        </CardHeader>
        {showStaleOutcomeFailures && (
          <CardContent className="pt-0">
            <div className="divide-y rounded-xl border bg-background">
              {summary.data?.staleOutcomeFailures?.length ? (
                summary.data.staleOutcomeFailures.map(failure => (
                  <div
                    key={failure.deliveryId}
                    className="flex flex-col gap-2 px-4 py-3 text-xs sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="font-medium">
                        {failure.asset} · {failure.timeframe} · Signal #
                        {failure.signalId ?? "—"}
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        {failure.status} · {failure.error}
                      </p>
                    </div>
                    <div className="text-left text-muted-foreground sm:text-right">
                      <p>
                        Retry attempts:{" "}
                        <b className="text-foreground">{failure.retryCount}</b>
                      </p>
                      <p>{formatDateTime(failure.createdAt)}</p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="p-4 text-sm text-muted-foreground">
                  No stale failed outcome records.
                </p>
              )}
            </div>
          </CardContent>
        )}
      </Card>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="font-display text-xl">
            Generated signals
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {loading ? (
              <div className="p-10 text-center text-sm text-muted-foreground">
                Loading signal history…
              </div>
            ) : signals.data?.length ? (
              signals.data.map(s => (
                <div
                  key={s.id}
                  className="grid gap-3 px-5 py-4 md:grid-cols-[1.15fr_1fr_.7fr_.9fr_auto] md:items-center"
                >
                  <div>
                    <p className="font-medium">
                      {s.asset}{" "}
                      <span className="text-xs text-muted-foreground">
                        · {s.timeframe}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {s.direction} · Entry {s.entry}
                    </p>
                    <div className="mt-2">
                      <Badge
                        variant="outline"
                        className={
                          s.generationMode === "ENTRY_LOCATOR_V5"
                            ? "border-primary/30 text-primary"
                            : "border-slate-400/40 text-slate-600"
                        }
                      >
                        {s.generationMode === "ENTRY_LOCATOR_V5"
                          ? "V5 · Entry Locator"
                          : s.intelligenceVersion?.includes("v5")
                            ? "V5 · Historical snapshot"
                            : intelligenceVersionLabel(s.intelligenceVersion ?? "")}
                      </Badge>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Sent {formatDateTime(s.openedAt)}
                    </p>
                    {(s.status === "WIN" || s.status === "LOSS") && (
                      <div className="mt-1 text-[11px] leading-4 text-muted-foreground">
                        <p>
                          Evidence candle {formatDateTime(s.resolutionCandleAt)}{" "}
                          ·{" "}
                          {s.resolutionUsedIntrabar
                            ? "intrabar range"
                            : "close price"}
                        </p>
                        <p>
                          Observed {s.resolutionPrice ?? "—"} · High{" "}
                          {s.resolutionHigh ?? "—"} · Low{" "}
                          {s.resolutionLow ?? "—"}
                        </p>
                        {s.outcomeNote && (
                          <p className="mt-1 max-w-xl text-[10px] text-muted-foreground/80">
                            {s.outcomeNote}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <p>
                      SL {s.stopLoss} · TP {s.takeProfit}
                    </p>
                    <Badge
                      variant="outline"
                      className={`mt-2 ${riskRewardLabel(s) === "1:2 verified" ? "border-emerald-500/25 bg-emerald-500/5 text-emerald-600" : "border-amber-500/25 bg-amber-500/5 text-amber-700"}`}
                    >
                      {riskRewardLabel(s)}
                    </Badge>
                  </div>
                  <div className="text-sm font-medium">
                    {s.confidence}%{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      confidence
                    </span>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Outcome</p>
                    <StatusPill status={s.status} />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Telegram</p>
                    <StatusPill
                      status={s.telegramDelivery?.status ?? "NOT RECORDED"}
                    />
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {formatDateTime(
                        s.telegramDelivery?.deliveredAt ??
                          s.telegramDelivery?.createdAt
                      )}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-10 text-center text-sm text-muted-foreground">
                No generated signals yet. The strategy-rules algorithm will
                place supported outcomes here after the scanner supplies raw
                market data.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      <AdjustmentHistory />
      <UpgradeChainHistory />
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="font-display text-xl">Audited ideas</CardTitle>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {audits.data?.length ? (
            audits.data.map(audit => (
              <div
                key={audit.id}
                className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium">
                    {audit.asset}{" "}
                    <span className="text-xs text-muted-foreground">
                      · {audit.timeframe ?? "15MIN"}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Audited {formatDateTime(audit.createdAt)} ·{" "}
                    {audit.confidence ?? "—"}% confidence
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusPill status={audit.verdict} />
                  {audit.verdict === "APPROVED" && (
                    <div>
                      <StatusPill
                        status={
                          audit.telegramDelivery?.status ?? "NOT RECORDED"
                        }
                      />
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {formatDateTime(
                          audit.telegramDelivery?.deliveredAt ??
                            audit.telegramDelivery?.createdAt
                        )}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No audited ideas yet.
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
function ClipboardCheckIcon(
  props: React.ComponentProps<typeof ClipboardCheck>
) {
  return <ClipboardCheck {...props} />;
}

function parseStoredJson(value: unknown): any {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isPlaceholderDecision(decision: {
  decisionReason?: string | null;
  confidence?: string | number | null;
}) {
  return (
    String(decision.decisionReason ?? "")
      .toLowerCase()
      .includes("no structured judgment") ||
    Number(decision.confidence ?? 0) === 0
  );
}

function AdaptiveGeometryDiagnostics() {
  const query = trpc.intelligence.entryLocator.useQuery(
    undefined,
    LIVE_QUERY_OPTIONS
  );
  const parse = (value: string | null | undefined) => {
    try {
      return JSON.parse(value ?? "{}");
    } catch {
      return {};
    }
  };
  return (
    <Card className="mt-6 border-amber-500/20 bg-amber-500/[0.025]">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="font-display text-xl">
              Adaptive geometry diagnostics
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Breakout confirmation and next opposing-zone evidence retained for
              the hierarchical Entry Locator.
            </p>
          </div>
          <Badge
            variant="outline"
            className="border-amber-500/30 text-amber-700"
          >
            PAPER ONLY
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        {(query.data ?? []).map(row => {
          const state = parse(row.stateJson);
          const latest = state.snapshots?.at?.(-1) ?? {};
          const direction = latest.direction ?? row.lastDirection ?? "—";
          const nextZone =
            direction === "BUY"
              ? latest.nextResistance
              : direction === "SELL"
                ? latest.nextSupport
                : null;
          return (
            <div
              key={`${row.asset}-${row.timeframe}`}
              className="rounded-xl border bg-background p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">
                  {row.asset} · {row.timeframe}
                </p>
                <StatusPill status={row.status} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <span className="text-muted-foreground">
                  Direction: <b className="text-foreground">{direction}</b>
                </span>
                <span className="text-muted-foreground">
                  Mode:{" "}
                  <b className="text-foreground">
                    {latest.geometryMode ?? "—"}
                  </b>
                </span>
                <span className="text-muted-foreground">
                  Breakout:{" "}
                  <b className="text-foreground">
                    {latest.breakoutState ?? "—"}
                  </b>
                </span>
                <span className="text-muted-foreground">
                  Confirmed:{" "}
                  <b className="text-foreground">
                    {latest.breakoutConfirmed ? "YES" : "NO"}
                  </b>
                </span>
              </div>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                Next opposing zone:{" "}
                <b className="text-foreground">
                  {nextZone == null ? "not recorded" : nextZone}
                </b>
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {row.snapshotCount} snapshots · last candle{" "}
                {formatDateTime(row.lastSnapshotAt)} · state saved{" "}
                {formatDateTime(row.updatedAt)}
              </p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function ScannerCadenceDiagnostics() {
  const query = trpc.scanner.cadence.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const data = query.data;
  const metric = (
    label: string,
    value: number | string,
    tone = "text-foreground"
  ) => (
    <div className="rounded-xl border bg-background p-3">
      <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className={`mt-2 font-display text-2xl font-semibold ${tone}`}>
        {value}
      </p>
    </div>
  );
  const latestAgeMinutes = data?.lastRunAt
    ? Math.max(
        0,
        Math.round((Date.now() - new Date(data.lastRunAt).getTime()) / 60_000)
      )
    : null;
  const cadenceLoading = query.isLoading || (!data && query.isFetching);
  const latestRunHasProviderIssue = Boolean(
    data?.lastRunAt &&
      data.latestProviderIssue &&
      new Date(data.latestProviderIssue.at).getTime() >=
        new Date(data.lastRunAt).getTime() - 60_000
  );
  const currentHealthy =
    !cadenceLoading &&
    Boolean(
      data?.lastRunAt &&
        latestAgeMinutes !== null &&
        latestAgeMinutes <= 10 &&
        (data?.failedCycles ?? 0) === 0 &&
        !latestRunHasProviderIssue
    );
  return (
    <Card className="mt-6 border-primary/15 bg-primary/[0.025]">
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="font-display text-xl">
              Five-minute cadence diagnostics
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              External trigger and Heartbeat runs from the last 24 hours. A
              skipped window means no app-side run was recorded for that shared
              five-minute bucket.
            </p>
          </div>
          <Badge
            variant="outline"
            className="w-fit border-primary/25 text-primary"
          >
            LIVE · REFRESH 1 MIN
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        <div
          className={`rounded-xl border p-3 text-sm ${cadenceLoading ? "border-slate-300 bg-slate-50 text-slate-700" : currentHealthy ? "border-emerald-500/25 bg-emerald-500/5 text-emerald-800" : "border-amber-500/25 bg-amber-500/5 text-amber-800"}`}
        >
          <p className="font-medium">
            {cadenceLoading
              ? "Current scanner health: checking"
              : currentHealthy
                ? "Current scanner health: healthy"
                : "Current scanner health: needs observation"}
          </p>
          <p className="mt-1 text-xs leading-5">
            {cadenceLoading
              ? "Loading the latest scanner ledger; no health conclusion is made until the diagnostics arrive."
              : data?.lastRunAt
                ? `The latest recorded cycle was ${latestAgeMinutes} minute${latestAgeMinutes === 1 ? "" : "s"} ago. Historical skipped-window counts below do not by themselves indicate a current failure.`
                : "No recent cycle is recorded yet. Watch for a successful external-trigger or Heartbeat run before treating the session as healthy."}{" "}
            Next session check: confirm a new SUCCEEDED cycle, marketData
            available, and no run error.
          </p>
        </div>
        {data?.latestProviderIssue && (
          <div
            role="alert"
            className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900"
          >
            <div className="flex items-start gap-3">
              <TrendingDown className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">
                  {data.latestProviderIssue.severity === "TRANSIENT"
                    ? "Twelve Data transient connection warning"
                    : data.latestProviderIssue.severity === "QUOTA"
                      ? "Twelve Data quota or rate-limit warning"
                      : "Twelve Data provider warning"}
                </p>
                <p className="mt-1 text-xs leading-5">
                  Latest affected interval
                  {data.latestProviderIssue.intervals.length === 1 ? "" : "s"}:{" "}
                  {data.latestProviderIssue.intervals.join(" · ")} · detected{" "}
                  {formatDateTime(data.latestProviderIssue.at)} via{" "}
                  {data.latestProviderIssue.source === "EXTERNAL_TRIGGER"
                    ? "external trigger"
                    : "Heartbeat"}
                  .
                </p>
                <p className="mt-1 text-xs leading-5">
                  This cycle could not supply market data, so v5 did not
                  evaluate setups and no v5 Entry Locator signal
                  was created. Unavailable provider cycles in the last 24 hours:{" "}
                  {data.providerUnavailableCycles ?? 0}.{" "}
                  {data.latestProviderIssue.severity === "TRANSIENT"
                    ? "The scanner will retry on the next scheduled cycle; this is not a quota conclusion."
                    : "Review provider credentials or quota status before treating the next cycle as reliable."}
                </p>
                <p className="mt-1 text-[11px] leading-4 text-amber-800/80">
                  Provider detail: {data.latestProviderIssue.message}
                </p>
              </div>
            </div>
          </div>
        )}
        {query.isError ? (
          <p className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-sm text-rose-700">
            Cadence diagnostics are unavailable. Refresh after the scanner
            ledger reconnects.
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {metric("Received cycles", data?.receivedCycles ?? 0)}
              {metric(
                "True skipped windows",
                data?.skippedWindows ?? 0,
                data?.skippedWindows ? "text-amber-700" : "text-emerald-700"
              )}
              {metric(
                "Completed",
                data?.completedCycles ?? 0,
                "text-emerald-700"
              )}
              {metric(
                "Failed",
                data?.failedCycles ?? 0,
                data?.failedCycles ? "text-rose-700" : "text-emerald-700"
              )}
              {metric(
                "Provider-unavailable",
                data?.providerUnavailableWindows ?? 0,
                data?.providerUnavailableWindows ? "text-amber-700" : "text-emerald-700"
              )}
              {metric("Duplicates suppressed", data?.duplicateSuppressed ?? 0)}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">
              <span>
                Average interval:{" "}
                <b className="text-foreground">
                  {data?.averageIntervalMinutes == null
                    ? "—"
                    : `${data.averageIntervalMinutes} min`}
                </b>
              </span>
              <span>
                External:{" "}
                <b className="text-foreground">{data?.externalCycles ?? 0}</b> ·
                Heartbeat:{" "}
                <b className="text-foreground">{data?.heartbeatCycles ?? 0}</b>
              </span>
              <span>
                Last source:{" "}
                <b className="text-foreground">{data?.lastSource ?? "—"}</b> ·{" "}
                {formatDateTime(data?.lastRunAt)}
              </span>
              <span>
                Diagnostics checked: {formatDateTime(data?.checkedAt)}
              </span>
            </div>
            {data?.runs?.length ? (
              <div className="overflow-hidden rounded-xl border bg-background">
                <div className="border-b bg-muted/25 px-3 py-2.5">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground">Production health timeline</p>
                  <p className="mt-1 text-[11px] leading-4 text-muted-foreground">Recent scheduler cycles at a glance. Telegram is only attempted after v5 qualifies and the Entry Locator emits a signal.</p>
                </div>
                <div className="divide-y">
                  {data.runs.slice(0, 8).map(run => {
                    const hasMarketData = run.marketData === "available";
                    const qualified = Number(run.createdSignals ?? 0) > 0;
                    const source = run.taskUid === "external-cron-job" ? "External trigger" : "Heartbeat";
                    return (
                      <div key={run.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                            <span className="font-semibold text-foreground">{formatDateTime(run.startedAt)}</span>
                            <span className="text-muted-foreground">{source}</span>
                            <Badge variant="outline" className={run.status === "SUCCEEDED" ? "border-emerald-500/25 text-emerald-700" : run.status === "FAILED" ? "border-rose-500/25 text-rose-700" : "border-amber-500/25 text-amber-700"}>{run.status}</Badge>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                            <span className={`rounded-full border px-2 py-0.5 ${hasMarketData ? "border-emerald-500/25 bg-emerald-500/5 text-emerald-700" : "border-amber-500/25 bg-amber-500/5 text-amber-800"}`}>Data · {hasMarketData ? "available" : run.marketData === "unavailable" ? "unavailable" : "not run"}</span>
                            <span className={`rounded-full border px-2 py-0.5 ${qualified ? "border-emerald-500/25 bg-emerald-500/5 text-emerald-700" : "border-slate-300 bg-slate-50 text-slate-700"}`}>v5 · {qualified ? `${run.createdSignals} qualified` : "waiting"}</span>
                            <span className={`rounded-full border px-2 py-0.5 ${qualified ? "border-blue-500/25 bg-blue-500/5 text-blue-700" : "border-slate-300 bg-slate-50 text-slate-700"}`}>Telegram · {qualified ? "path started" : "not attempted"}</span>
                          </div>
                        </div>
                        <p className="shrink-0 text-[11px] text-muted-foreground">{run.finishedAt ? `Finished ${formatDateTime(run.finishedAt)}` : "Still running"}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No scanner cycles recorded in the last 24 hours.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function V5SmokeStatusCard() {
  const smoke = trpc.scanner.v5Smoke.useQuery(undefined, LIVE_QUERY_OPTIONS);
  const data = smoke.data;
  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="font-display text-xl">Authenticated v5 production smoke</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Checks recent successful scanner cycles against complete persisted hierarchy payloads.</p>
          </div>
          <Badge className={data?.ok ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600" : "border-amber-500/20 bg-amber-500/10 text-amber-700"}>{data?.ok ? "PASS" : smoke.isLoading ? "CHECKING" : "WAITING"}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {smoke.isError ? <DataError text="Authenticated v5 smoke status could not be loaded." /> : (
          <>
            <div className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-4">
            <span>Payloads checked: <b className="text-foreground">{data?.checkedDecisions ?? 0}</b></span>
            <span>Qualified: <b className="text-emerald-600">{data?.qualified ?? 0}</b></span>
            <span>Waiting: <b className="text-amber-700">{data?.waiting ?? 0}</b></span>
            <span>Actual ratios: <b className="text-foreground">{data?.actualRatios?.length ? data.actualRatios.join(", ") : "—"}</b></span>
          </div>
          <div className="mt-3 grid gap-3 text-xs text-muted-foreground sm:grid-cols-4">
            <span>Complete payloads: <b className="text-foreground">{data?.payloadChecks?.filter(check => check.complete).length ?? 0}/{data?.payloadChecks?.length ?? 0}</b></span>
            <span>Active zones: <b className="text-emerald-600">{data?.zoneInventory?.active ?? 0}</b></span>
            <span>Weakened zones: <b className="text-amber-700">{data?.zoneInventory?.weakened ?? 0}</b></span>
            <span>Invalidated retained: <b className="text-foreground">{data?.zoneInventory?.invalidated ?? 0}</b></span>
          </div>
          </>
        )}
        <p className="mt-3 text-xs leading-5 text-muted-foreground">{data?.reason ?? "Waiting for an authenticated production check."}</p>
      </CardContent>
    </Card>
  );
}

function V5DecisionTrend() {
  const decisions = trpc.scanner.decisions.useQuery(undefined, LIVE_QUERY_OPTIONS);
  const buckets = useMemo(() => {
    const now = Date.now();
    const grouped = new Map<number, { label: string; qualified: number; waiting: number; total: number }>();
    for (let offset = 23; offset >= 0; offset -= 1) {
      const hour = new Date(now - offset * 60 * 60 * 1000);
      const key = new Date(hour.getFullYear(), hour.getMonth(), hour.getDate(), hour.getHours()).getTime();
      grouped.set(key, { label: hour.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), qualified: 0, waiting: 0, total: 0 });
    }
    for (const decision of decisions.data ?? []) {
      const created = new Date(decision.createdAt);
      if (now - created.getTime() > 24 * 60 * 60 * 1000) continue;
      const key = new Date(created.getFullYear(), created.getMonth(), created.getDate(), created.getHours()).getTime();
      const bucket = grouped.get(key);
      if (!bucket) continue;
      const snapshot = parseStoredJson(decision.marketSnapshot);
      const workflow = snapshot && typeof snapshot === "object" ? (snapshot as { replacementIntelligence?: { workflow?: { status?: string } } }).replacementIntelligence?.workflow : null;
      if (workflow?.status === "QUALIFIED") bucket.qualified += 1;
      if (workflow?.status === "WAITING") bucket.waiting += 1;
      if (workflow?.status === "QUALIFIED" || workflow?.status === "WAITING") bucket.total += 1;
    }
    return Array.from(grouped.values());
  }, [decisions.data]);
  const max = Math.max(1, ...buckets.map(bucket => bucket.total));
  const qualified = buckets.reduce((sum, bucket) => sum + bucket.qualified, 0);
  const waiting = buckets.reduce((sum, bucket) => sum + bucket.waiting, 0);
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="font-display text-xl">V5 qualification trend · last 24 hours</CardTitle>
        <p className="text-xs leading-5 text-muted-foreground">Counts only persisted hierarchy decisions. A quiet hour remains quiet; it is not treated as a failed or qualified cycle.</p>
      </CardHeader>
      <CardContent>
        {decisions.isError ? <DataError text="The v5 qualification trend could not be loaded." /> : decisions.isLoading ? <p className="text-sm text-muted-foreground">Loading qualification history…</p> : (
          <>
            <div className="mb-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span><b className="text-emerald-600">{qualified}</b> qualified</span>
              <span><b className="text-amber-600">{waiting}</b> waiting</span>
              <span>{qualified + waiting} decisions with hierarchy status</span>
            </div>
            <div className="grid h-32 grid-cols-[repeat(24,minmax(0,1fr))] items-end gap-1" aria-label="V5 qualified and waiting decisions by hour">
              {buckets.map((bucket, index) => (
                <div key={`${bucket.label}-${index}`} className="flex h-full min-w-0 flex-col justify-end gap-1" title={`${bucket.label}: ${bucket.qualified} qualified, ${bucket.waiting} waiting`}>
                  <div className="flex min-h-0 flex-1 flex-col justify-end gap-px">
                    {bucket.qualified > 0 && <div className="rounded-t-sm bg-emerald-500/75" style={{ height: `${(bucket.qualified / max) * 100}%` }} />}
                    {bucket.waiting > 0 && <div className="bg-amber-500/70" style={{ height: `${(bucket.waiting / max) * 100}%` }} />}
                  </div>
                  {index % 4 === 0 && <span className="truncate text-[9px] text-muted-foreground">{bucket.label}</span>}
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-4 text-[11px] text-muted-foreground"><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-500/75" />Qualified</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-amber-500/70" />Waiting</span></div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function V5ZoneMap() {
  const decisions = trpc.scanner.decisions.useQuery(undefined, LIVE_QUERY_OPTIONS);
  const zoneHistory = trpc.scanner.zoneHistory.useQuery(undefined, LIVE_QUERY_OPTIONS);
  const latestByAsset = useMemo(() => {
    const map = new Map<string, any>();
    for (const decision of decisions.data ?? []) {
      const current = map.get(decision.asset);
      if (!current || new Date(decision.createdAt).getTime() > new Date(current.createdAt).getTime()) map.set(decision.asset, decision);
    }
    return map;
  }, [decisions.data]);
  const formatZone = (zone: any) => zone ? `${zone.zoneKind ?? zone.kind} ${Number(zone.lower).toFixed(5)}–${Number(zone.upper).toFixed(5)}` : "No persisted zone";
  const ageLabel = (createdAt: string | Date) => {
    const ageMinutes = Math.max(0, Math.round((Date.now() - new Date(createdAt).getTime()) / 60_000));
    return ageMinutes <= 15 ? `FRESH · ${ageMinutes}m` : ageMinutes <= 60 ? `AGING · ${ageMinutes}m` : `STALE · ${ageMinutes}m`;
  };
  const labelForTimeframe = (timeframe: string) => timeframe === "15MIN" ? "15M" : timeframe === "5MIN" ? "5M" : timeframe;
  return (
    <Card className="mb-6 border-primary/15 bg-primary/[0.025]">
      <CardHeader>
        <CardTitle className="font-display text-xl">V5 persistent zone inventory</CardTitle>
        <p className="text-xs leading-5 text-muted-foreground">Each asset has its own durable zone map across 4H, 1H, 15M, and 5M. Active and weakened records remain visible with observation and retest counts; invalidated records are retained in the database but excluded from current evidence.</p>
      </CardHeader>
      <CardContent>
        {decisions.isError || zoneHistory.isError ? <DataError text="The v5 zone inventory could not be loaded. Refresh after the scanner records recover." /> : decisions.isLoading || zoneHistory.isLoading ? <p className="text-sm text-muted-foreground">Loading persistent zone inventory…</p> : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {WATCHLIST.map(item => {
              const assetZones = (zoneHistory.data ?? []).filter((zone: any) => zone.asset === item.symbol);
              const decision = latestByAsset.get(item.symbol);
              const snapshot = decision ? parseStoredJson(decision.marketSnapshot) : null;
              const workflow = snapshot && typeof snapshot === "object" ? (snapshot as { replacementIntelligence?: { workflow?: any } }).replacementIntelligence?.workflow : null;
              return (
                <div key={item.symbol} className="rounded-xl border bg-background p-4">
                  <div className="flex items-center justify-between gap-2"><p className="font-medium">{item.symbol}</p><Badge variant="outline" className="text-[10px]">{assetZones.length} zones</Badge></div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{decision ? `Hierarchy ${workflow?.status ?? "RECORDED"} · ${formatDateTime(decision.createdAt)}` : "Awaiting persisted hierarchy data"}</p>
                  <div className="mt-4 space-y-3 text-xs">
                    {(["4H", "1H", "15MIN", "5MIN"] as const).map(timeframe => {
                      const zones = assetZones.filter((zone: any) => zone.timeframe === timeframe);
                      const current = zones.find((zone: any) => zone.lifecycle === "ACTIVE") ?? zones[0];
                      return <div key={timeframe} className="rounded-lg bg-muted/30 p-3"><div className="flex items-center justify-between"><p className="font-semibold uppercase tracking-[0.14em] text-muted-foreground">{labelForTimeframe(timeframe)}</p><span className="text-[10px] text-muted-foreground">{current?.lifecycle ?? "EMPTY"}</span></div>{current ? <><p className="mt-2 font-medium">{formatZone(current)}</p><p className="mt-1 text-[11px] text-muted-foreground">{current.observationCount} observations · {current.retestCount} retests · {current.fresh ? "fresh" : "retested/older"}</p><p className="mt-1 text-[11px] text-muted-foreground">Seen {ageLabel(current.lastSeenAt)}</p></> : <p className="mt-2 text-muted-foreground">No persisted zone</p>}</div>;
                    })}
                  </div>
                  <div className="mt-4 border-t pt-3"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Inventory summary</p><p className="mt-2 text-[11px] text-muted-foreground">{assetZones.filter((zone: any) => zone.lifecycle === "ACTIVE").length} active · {assetZones.filter((zone: any) => zone.lifecycle === "WEAKENED").length} weakened · {assetZones.filter((zone: any) => zone.lifecycle === "INVALIDATED").length} invalidated</p></div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReplacementChainMonitoringCard() {
  const adjustments = trpc.signals.adjustments.useQuery(undefined, LIVE_QUERY_OPTIONS);
  const chains = trpc.signals.upgradeChains.useQuery(undefined, LIVE_QUERY_OPTIONS);
  const rows = chains.data ?? [];
  const resolvedParents = rows.filter(chain => chain.original && chain.original.status !== "PENDING").length;
  const pendingReplacements = rows.filter(chain => chain.replacement?.status === "PENDING").length;
  const latest = rows[0];
  return (
    <Card className="mt-6 border-primary/20 bg-primary/[0.025]">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="font-display text-xl">Replacement-chain integrity</CardTitle>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Read-only visibility into resolved-parent chaining, threaded replies, and exact duplicate suppression.
            </p>
          </div>
          <Badge variant="outline" className="w-fit border-emerald-500/30 text-emerald-700">DEDUPLICATION ENFORCED</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-4">
          <SummaryStat label="Adjustments" value={adjustments.data?.length ?? 0} tone="neutral" />
          <SummaryStat label="Linked chains" value={rows.length} tone="neutral" />
          <SummaryStat label="Closed parents" value={resolvedParents} tone="good" />
          <SummaryStat label="Pending replacements" value={pendingReplacements} tone="neutral" />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border bg-background p-3 text-xs leading-5 text-muted-foreground">
            <p className="font-semibold uppercase tracking-[0.14em] text-foreground">Chain rule</p>
            <p className="mt-1">A later opposite setup can reply to the previous replacement only after the original parent is closed and the candidate passes v5 hierarchy approval followed by Entry Locator gates.</p>
          </div>
          <div className="rounded-xl border bg-background p-3 text-xs leading-5 text-muted-foreground">
            <p className="font-semibold uppercase tracking-[0.14em] text-foreground">Exact identity</p>
            <p className="mt-1">Asset, timeframe, direction, entry, stop, target, risk ratio, confidence, and confluence are checked before another signal or Telegram delivery is created.</p>
          </div>
        </div>
        {latest && (
          <p className="mt-3 text-[11px] text-muted-foreground">
            Latest linked chain: {latest.adjustment.asset} · {latest.adjustment.timeframe} · parent {latest.original?.status ?? "unavailable"} → replacement {latest.replacement?.status ?? "unavailable"}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function MonitoringPage() {
  return (
    <>
      <PageHeading
        eyebrow="Continuous observability"
        title="Monitoring"
        description="A read-only control room for scanner cadence, market-data availability, v5 hierarchy persistence, zones, and signal-path health. Monitoring never changes v5 decisions or Telegram delivery."
        action={<Badge variant="outline" className="w-fit border-primary/25 text-primary">LIVE · REFRESH 1 MIN</Badge>}
      />
      <div className="mb-6 grid gap-3 md:grid-cols-3">
        <Card className="border-primary/15 bg-primary/[0.025]"><CardContent className="p-4"><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">What this watches</p><p className="mt-2 text-sm leading-6">Scheduler callbacks, five-minute freshness, provider availability, and complete hierarchy payloads.</p></CardContent></Card>
        <Card className="border-primary/15 bg-primary/[0.025]"><CardContent className="p-4"><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Decision boundary</p><p className="mt-2 text-sm leading-6">4H bias, 1H context, and independent 15M/5M execution remain owned by v5.</p></CardContent></Card>
        <Card className="border-primary/15 bg-primary/[0.025]"><CardContent className="p-4"><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Delivery boundary</p><p className="mt-2 text-sm leading-6">Telegram is attempted only after a qualified v5 plan and Entry Locator emission.</p></CardContent></Card>
      </div>
      <CallbackStatusCard />
      <ScannerCadenceDiagnostics />
      <V5SmokeStatusCard />
      <V5DecisionTrend />
      <V5ZoneMap />
      <ReplacementChainMonitoringCard />
    </>
  );
}

function ScannerPage() {
  const settings = trpc.scanner.status.useQuery(undefined, LIVE_QUERY_OPTIONS);
  const health = trpc.scanner.health.useQuery(undefined, LIVE_QUERY_OPTIONS);
  const cadence = trpc.scanner.cadence.useQuery(undefined, LIVE_QUERY_OPTIONS);
  const [assetFilter, setAssetFilter] = useState("all");
  const [timeframeFilter, setTimeframeFilter] = useState("all");
  const [verdictFilter, setVerdictFilter] = useState("all");
  const [expandedDecision, setExpandedDecision] = useState<number | null>(null);
  const [exportFormat, setExportFormat] = useState<"csv" | "json" | null>(null);
  const decisionFilters = useMemo(
    () => ({
      asset: assetFilter === "all" ? undefined : assetFilter,
      timeframe:
        timeframeFilter === "all"
          ? undefined
          : (timeframeFilter as "15MIN" | "5MIN"),
      verdict:
        verdictFilter === "all"
          ? undefined
          : (verdictFilter as
              | "APPROVED"
              | "DENIED"
              | "SKIPPED"
              | "UNAVAILABLE"),
    }),
    [assetFilter, timeframeFilter, verdictFilter]
  );
  const decisions = trpc.scanner.decisions.useQuery(
    decisionFilters,
    LIVE_QUERY_OPTIONS
  );
  const confluenceRows = useMemo(
    () =>
      WATCHLIST.map(item => {
        const rows = (decisions.data ?? []).filter(
          decision => decision.asset === item.symbol
        );
        const fast = rows.find(decision => decision.timeframe === "15MIN");
        const slow = rows.find(decision => decision.timeframe === "5MIN");
        const fastDirection = fast?.generatedDirection;
        const slowDirection = slow?.generatedDirection;
        return {
          asset: item.symbol,
          fast,
          slow,
          aligned: Boolean(
            fastDirection && slowDirection && fastDirection === slowDirection
          ),
          direction:
            fastDirection && fastDirection === slowDirection
              ? fastDirection
              : (fastDirection ?? slowDirection ?? "—"),
        };
      }).filter(row => row.fast || row.slow),
    [decisions.data]
  );
  const placeholderCount = (decisions.data ?? []).filter(
    isPlaceholderDecision
  ).length;
  const exportQuery = trpc.scanner.export.useQuery(
    { format: exportFormat ?? "csv", ...decisionFilters },
    { enabled: Boolean(exportFormat) }
  );
  useEffect(() => {
    if (!exportQuery.data || !exportFormat) return;
    const blob = new Blob([exportQuery.data.content], {
      type:
        exportFormat === "csv"
          ? "text/csv;charset=utf-8"
          : "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = exportQuery.data.filename;
    anchor.click();
    URL.revokeObjectURL(url);
    setExportFormat(null);
  }, [exportQuery.data, exportFormat]);
  const toggle = trpc.scanner.toggle.useMutation({
    onSuccess: () => settings.refetch(),
    onError: e => toast.error(e.message),
  });
  const updateCooldown = trpc.scanner.updateCooldown.useMutation({
    onSuccess: () => {
      settings.refetch();
      toast.success("Setup cooldown updated");
    },
    onError: e => toast.error(e.message),
  });
  const enabled = settings.data?.scannerEnabled ?? true;
  const modelAvailable = settings.data?.strategyEngineStatus === "AVAILABLE";
  const modelUnavailable =
    settings.data?.strategyEngineStatus === "UNAVAILABLE";
  const providerIssue = cadence.data?.latestProviderIssue;
  const providerOutageActive = Boolean(
    providerIssue &&
    (!cadence.data?.latestSuccessfulAt ||
      new Date(providerIssue.at).getTime() > new Date(cadence.data.latestSuccessfulAt).getTime())
  );
  const latestTimeframeHealth = cadence.data?.latestTimeframeHealth ?? [];

  return (
    <>
      {settings.isError && (
        <DataError text="Scanner settings could not be loaded. Refresh before changing autonomous controls." />
      )}
      <PageHeading
        eyebrow="Market-data collection"
        title="Rose’s Eye On The Markets"
        description="The external scheduler triggers collection of raw EUR/USD, XAU/USD, GBP/USD, and BTC/USD data for 4H bias, 1H context, and independent 15M and 5M signal evaluation. The strategy-rules algorithm analyzes that data and generates supported outcomes for tracking."
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              variant={enabled ? "outline" : "default"}
              onClick={() => toggle.mutate({ enabled: !enabled })}
            >
              {enabled ? "Pause data collection" : "Resume data collection"}
            </Button>
          </div>
        }
      />
      {(() => {
        const freshness = cadence.isLoading
          ? { label: "Checking…", tone: "text-muted-foreground", detail: "Loading the latest scanner cadence." }
          : cadence.isError
            ? { label: "Unavailable", tone: "text-rose-700", detail: "Scanner cadence could not be loaded." }
            : scannerFreshness(cadence.data?.latestSuccessfulAt);
        return (
          <Card className="mb-6 border-primary/15 bg-primary/[0.025]">
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><Radar className="h-5 w-5" /></div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Scanner freshness</p>
                  <p aria-live="polite" className={`mt-1 text-lg font-semibold ${freshness.tone}`}>{freshness.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{freshness.detail}</p>
                </div>
              </div>
              <div className="text-left text-xs text-muted-foreground sm:text-right">
                <p>Source: <b className="text-foreground">{cadence.isLoading || cadence.isError ? "—" : cadence.data?.latestSuccessfulSource ?? "—"}</b></p>
                <p className="mt-1">Expected cadence: <b className="text-foreground">5 min</b></p>
              </div>
            </CardContent>
          </Card>
        );
      })()}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="font-display text-xl">Required timeframe retrieval</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                The latest scanner cycle must retrieve 15M confirmation, 1H context, and 4H bias data before v5 can evaluate a complete hierarchy.
              </p>
            </div>
            <span className="text-xs text-muted-foreground">
              Latest cycle: {cadence.data?.latestSuccessfulAt ? formatDateTime(cadence.data.latestSuccessfulAt) : "—"}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            {(["15min", "1h", "4h"] as const).map(interval => {
              const item = latestTimeframeHealth.find(entry => entry.interval === interval);
              const status = item?.status ?? "NOT_RECORDED";
              const available = status === "AVAILABLE";
              const unavailable = status === "UNAVAILABLE";
              return (
                <div key={interval} className={`rounded-xl border p-3 ${available ? "border-emerald-500/25 bg-emerald-500/5" : unavailable ? "border-rose-500/25 bg-rose-500/5" : "border-slate-300 bg-slate-50"}`}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{interval}</p>
                    {available ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Clock3 className={`h-4 w-4 ${unavailable ? "text-rose-600" : "text-slate-500"}`} />}
                  </div>
                  <p className={`mt-2 text-sm font-semibold ${available ? "text-emerald-800" : unavailable ? "text-rose-800" : "text-slate-700"}`}>
                    {available ? "AVAILABLE" : unavailable ? "UNAVAILABLE" : "NOT RECORDED"}
                  </p>
                  <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                    {item?.at ? `Verified ${formatDateTime(item.at)}` : "Waiting for a recorded complete cycle"}
                  </p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
      {providerOutageActive && providerIssue ? (
        <Card role="alert" className="mb-6 border-amber-500/25 bg-amber-500/[0.04]">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-800">Twelve Data quota or rate-limit warning</p>
              <p className="mt-1 text-sm font-semibold text-amber-950">The latest scanner cycle could not obtain all required market data.</p>
              <p className="mt-1 text-xs leading-5 text-amber-900/80">
                The {providerIssue.intervals.join(", ")} data request was rejected at {formatDateTime(providerIssue.at)} with provider status {providerIssue.statusCode ?? "unavailable"}. No new v5 signal is emitted from an incomplete cycle.
              </p>
            </div>
            <div className="shrink-0 rounded-lg bg-amber-100/70 px-3 py-2 text-xs text-amber-900">
              Check the configured Twelve Data failover keys
            </div>
          </CardContent>
        </Card>
      ) : null}
      <AdaptiveGeometryDiagnostics />
      <ScannerCadenceDiagnostics />
      <V5SmokeStatusCard />
      <V5ZoneMap />
      <V5DecisionTrend />
      <div className="grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="font-display text-xl">
                  Collection status
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  External scheduler controls the collection cadence
                </p>
              </div>
              <Badge
                className={
                  enabled
                    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600"
                    : "border-amber-500/20 bg-amber-500/10 text-amber-600"
                }
              >
                {enabled ? "ACTIVE" : "PAUSED"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center gap-4 rounded-2xl bg-muted/40 p-4">
              <div className="rounded-xl bg-primary/10 p-3 text-primary">
                <Radar className="h-6 w-6" />
              </div>
              <div>
                <p className="font-medium">
                  Next collection cycle runs automatically
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  The strategy-rules algorithm generates signals only when the
                  ingested rules and raw market context support a possible
                  outcome.
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {WATCHLIST.map(x => (
                <div
                  key={x.symbol}
                  className="flex items-center justify-between rounded-xl border p-3"
                >
                  <div>
                    <p className="text-sm font-medium">{x.symbol}</p>
                    <p className="text-[11px] text-muted-foreground">
                      15MIN · 5MIN
                    </p>
                  </div>
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-xl">
              Collection and judgment health
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3">
              <Radar className="h-5 w-5 text-primary" />
              <div>
                <p className="font-medium">Market data collection</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {enabled ? "Active" : "Paused"} · Twelve Data snapshots feed
                  the strategy engine.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <div>
                <p className="font-medium">Strategy-engine availability</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {modelAvailable
                    ? "Available for judgments"
                    : modelUnavailable
                      ? "Unavailable"
                      : "Not run yet"}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Clock3 className="h-5 w-5 text-primary" />
              <div>
                <p className="font-medium">Setup cooldown</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Repeated market setups are not re-analyzed during the selected
                  window.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={1440}
                    defaultValue={settings.data?.setupCooldownMinutes ?? 30}
                    className="h-8 w-24"
                    onBlur={event =>
                      updateCooldown.mutate({
                        minutes: Number(event.currentTarget.value) || 0,
                      })
                    }
                  />
                  <span className="text-xs text-muted-foreground">minutes</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="font-display text-xl">
                  Strategy-engine response health
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Operational counters from the live raw-snapshot evaluation
                  path.
                </p>
              </div>
              <StatusPill status={health.data?.status ?? "NOT_RUN"} />
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-4">
            <SummaryStat
              label="Response completeness"
              value={health.data?.completenessPercent ?? 0}
              tone={health.data?.completenessPercent === 100 ? "good" : "bad"}
            />
            <SummaryStat
              label="Snapshots evaluated"
              value={health.data?.totalSnapshots ?? 0}
              tone="neutral"
            />
            <SummaryStat
              label="Retries used"
              value={health.data?.retryCount ?? 0}
              tone="neutral"
            />
            <SummaryStat
              label="Unavailable cycles"
              value={health.data?.unavailableCycles ?? 0}
              tone={health.data?.unavailableCycles ? "bad" : "good"}
            />
            <div className="sm:col-span-4 rounded-xl bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
              Last run: {formatDateTime(health.data?.lastRunAt)}
              {health.data?.lastError
                ? ` · ${health.data.lastError}`
                : " · No recorded model error"}
            </div>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-display text-xl">
              Multi-timeframe confluence
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Comparison of the strategy-rules algorithm’s 15-minute and 1-hour
              judgments. The market-data collector does not decide alignment.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {confluenceRows.length ? (
              confluenceRows.map(row => (
                <div
                  key={row.asset}
                  className="flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-medium">{row.asset}</p>
                    <p className="text-xs text-muted-foreground">
                      15MIN: {row.fast?.generatedDirection ?? "—"} · 5MIN:{" "}
                      {row.slow?.generatedDirection ?? "—"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      className={
                        row.aligned
                          ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600"
                          : "border-amber-500/20 bg-amber-500/10 text-amber-600"
                      }
                    >
                      {row.aligned
                        ? `Aligned ${row.direction}`
                        : "Mixed / incomplete"}
                    </Badge>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                No paired timeframe judgments are available yet.
              </p>
            )}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle className="font-display text-xl">
                  Strategy-engine decision ledger
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Every judgment is retained with its market snapshot, rule
                  evidence, confluence, and generated outcome. Select a row to
                  expand the evidence.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <select
                  aria-label="Filter ledger by asset"
                  value={assetFilter}
                  onChange={event => setAssetFilter(event.target.value)}
                  className="h-9 rounded-md border bg-background px-2 text-xs"
                >
                  <option value="all">All assets</option>
                  {WATCHLIST.map(item => (
                    <option key={item.symbol} value={item.symbol}>
                      {item.symbol}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Filter ledger by timeframe"
                  value={timeframeFilter}
                  onChange={event => setTimeframeFilter(event.target.value)}
                  className="h-9 rounded-md border bg-background px-2 text-xs"
                >
                  <option value="all">All timeframes</option>
                  <option value="15MIN">15MIN</option>
                  <option value="5MIN">5MIN</option>
                </select>
                <select
                  aria-label="Filter ledger by verdict"
                  value={verdictFilter}
                  onChange={event => setVerdictFilter(event.target.value)}
                  className="h-9 rounded-md border bg-background px-2 text-xs"
                >
                  <option value="all">All statuses</option>
                  <option value="APPROVED">Approved</option>
                  <option value="DENIED">Denied</option>
                  <option value="SKIPPED">Skipped</option>
                  <option value="UNAVAILABLE">Unavailable</option>
                </select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setExportFormat("csv")}
                  disabled={Boolean(exportFormat)}
                >
                  CSV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setExportFormat("json")}
                  disabled={Boolean(exportFormat)}
                >
                  JSON
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {decisions.isLoading ? (
              <p className="text-sm text-muted-foreground">
                Loading decision ledger…
              </p>
            ) : decisions.data?.length ? (
              decisions.data.slice(0, 8).map(decision => {
                const expanded = expandedDecision === decision.id;
                const evidence = parseStoredJson(decision.ruleEvidence);
                const snapshot = parseStoredJson(decision.marketSnapshot);
                const context =
                  snapshot && typeof snapshot === "object"
                    ? (snapshot as { marketContext?: any }).marketContext
                    : null;
                const workflow =
                  snapshot && typeof snapshot === "object"
                    ? (snapshot as { replacementIntelligence?: { workflow?: any } }).replacementIntelligence?.workflow
                    : null;
                const placeholder = isPlaceholderDecision(decision);
                return (
                  <div key={decision.id} className="rounded-xl border">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 p-4 text-left"
                      onClick={() =>
                        setExpandedDecision(expanded ? null : decision.id)
                      }
                    >
                      <div>
                        <p className="font-medium">
                          {decision.asset} · {decision.timeframe}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Judged {formatDateTime(decision.createdAt)} ·{" "}
                          {decision.confidence}% confidence ·{" "}
                          {decision.confluenceScore}% confluence
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusPill status={decision.verdict} />
                        <ChevronRight
                          className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`}
                        />
                      </div>
                    </button>
                    {expanded && (
                      <div className="grid gap-4 border-t bg-muted/20 p-4 md:grid-cols-2">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                            Rule citations
                          </p>
                          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-background p-3 text-xs leading-5">
                            {typeof evidence === "string"
                              ? evidence
                              : JSON.stringify(evidence ?? [], null, 2)}
                          </pre>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                            Market snapshot
                          </p>
                          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-background p-3 text-xs leading-5">
                            {typeof snapshot === "string"
                              ? snapshot
                              : JSON.stringify(snapshot ?? {}, null, 2)}
                          </pre>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                            Calculated market context
                          </p>
                          <p className="mt-2 text-sm leading-6 text-muted-foreground">
                            {context?.summary ??
                              "No calculated context was persisted for this judgment."}
                          </p>
                          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                            <span>
                              Structure:{" "}
                              <b className="text-foreground">
                                {context?.marketStructure ?? "—"}
                              </b>
                            </span>
                            <span>
                              Volatility:{" "}
                              <b className="text-foreground">
                                {context?.volatility?.regime ?? "—"}
                              </b>
                            </span>
                            <span>
                              Momentum:{" "}
                              <b className="text-foreground">
                                {context?.momentum?.direction ?? "—"}
                              </b>
                            </span>
                            <span>
                              Breakout:{" "}
                              <b className="text-foreground">
                                {context?.breakoutState ?? "—"}
                              </b>
                            </span>
                          </div>
                        </div>
                        {workflow && (
                          <div className="md:col-span-2 rounded-lg border border-primary/15 bg-primary/[0.03] p-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                              Hierarchical workflow
                            </p>
                            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground md:grid-cols-4">
                              <span>4H bias: <b className="text-foreground">{workflow.dominant4h ?? "—"}</b></span>
                              <span>1H trend: <b className="text-foreground">{workflow.trend1h ?? "—"}</b></span>
                              <span>Confirmation: <b className="text-foreground">{workflow.confirmation?.kind ?? "—"}</b></span>
                              <span>Actual R:R: <b className="text-foreground">{workflow.riskReward == null ? "—" : `1:${workflow.riskReward}`}</b></span>
                            </div>
                            <p className="mt-2 text-xs leading-5 text-muted-foreground">
                              {workflow.explanation ?? "No hierarchy explanation was persisted."}
                            </p>
                          </div>
                        )}
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                            Placeholder diagnostics
                          </p>
                          {placeholder ? (
                            <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm leading-6 text-amber-800">
                              No structured strategy-engine judgment was
                              returned. A BUY/SELL placeholder is shown for
                              audit visibility only and is not
                              Telegram-eligible.
                            </div>
                          ) : (
                            <p className="mt-2 text-sm text-muted-foreground">
                              This row contains a structured strategy-engine
                              response.
                            </p>
                          )}
                        </div>
                        <div className="md:col-span-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                            Generated outcome
                          </p>
                          <p className="mt-2 text-sm leading-6 text-muted-foreground">
                            {decision.verdict === "APPROVED"
                              ? `${decision.generatedDirection ?? "—"} · Entry ${decision.generatedEntry ?? "—"} · SL ${decision.generatedStopLoss ?? "—"} · TP ${decision.generatedTakeProfit ?? "—"}`
                              : (decision.decisionReason ??
                                "No supported outcome generated.")}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <p className="text-sm text-muted-foreground">
                No strategy-engine judgments have been recorded yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

type WinningRateMetricView = {
  generated: number;
  resolved: number;
  wins: number;
  losses: number;
  winRate: number | null;
};
type WinningRateVersionView = {
  version: string;
  overall: WinningRateMetricView;
  assets: Array<WinningRateMetricView & { key: string }>;
  timeframes: Array<
    WinningRateMetricView & { key: string; asset: string; timeframe: string }
  >;
  confidenceBands: Array<WinningRateMetricView & { key: string }>;
  confidenceByAssetTimeframe: Array<
    WinningRateMetricView & {
      key: string;
      asset: string;
      timeframe: string;
      confidenceBand: string;
    }
  >;
};
function WinningRateMetricCells({ metric }: { metric: WinningRateMetricView }) {
  return (
    <>
      <td className="px-3 py-3 text-right">{metric.generated}</td>
      <td className="px-3 py-3 text-right">{metric.resolved}</td>
      <td className="px-3 py-3 text-right text-emerald-600">{metric.wins}</td>
      <td className="px-3 py-3 text-right text-rose-600">{metric.losses}</td>
      <td className="px-3 py-3 text-right font-semibold">
        {metric.winRate == null ? "—" : `${metric.winRate}%`}
      </td>
    </>
  );
}
function WinningRateTable({
  title,
  rows,
  keyLabel,
}: {
  title: string;
  rows: Array<WinningRateMetricView & { key: string }>;
  keyLabel: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                <th className="px-3 py-3">{keyLabel}</th>
                <th className="px-3 py-3 text-right">Generated</th>
                <th className="px-3 py-3 text-right">Resolved</th>
                <th className="px-3 py-3 text-right">Wins</th>
                <th className="px-3 py-3 text-right">Losses</th>
                <th className="px-3 py-3 text-right">Win rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.key} className="border-b last:border-0">
                  <td className="px-3 py-3 font-medium">{row.key}</td>
                  <WinningRateMetricCells metric={row} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
function WinningRateConfidenceGroups({
  rows,
}: {
  rows: WinningRateVersionView["confidenceByAssetTimeframe"];
}) {
  const groups = Array.from(
    new Map(
      rows.map(row => [
        `${row.asset} · ${row.timeframe}`,
        {
          asset: row.asset,
          timeframe: row.timeframe,
          rows: rows.filter(
            item => item.asset === row.asset && item.timeframe === row.timeframe
          ),
        },
      ])
    ).values()
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-lg">
          Confidence bands by asset and timeframe
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Each group contains the complete confidence-band record for one asset
          and timeframe.
        </p>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2 rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          Read each card as one isolated asset/timeframe view. The five
          requested bands stay together for easier comparison.
        </div>
        {groups.map(group => (
          <div
            key={`${group.asset}-${group.timeframe}`}
            className="overflow-hidden rounded-xl border"
          >
            <div className="border-b bg-primary/[0.045] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                Asset / timeframe
              </p>
              <p className="mt-1 font-display text-lg font-semibold">
                {group.asset} · {group.timeframe}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-xs">
                <thead>
                  <tr className="border-b text-left text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    <th className="px-3 py-2.5">Confidence band</th>
                    <th className="px-3 py-2.5 text-right">Generated</th>
                    <th className="px-3 py-2.5 text-right">Resolved</th>
                    <th className="px-3 py-2.5 text-right">Wins</th>
                    <th className="px-3 py-2.5 text-right">Losses</th>
                    <th className="px-3 py-2.5 text-right">Win rate</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map(row => (
                    <tr key={row.key} className="border-b last:border-0">
                      <td className="px-3 py-2.5 font-medium">
                        {row.confidenceBand}
                      </td>
                      <WinningRateMetricCells metric={row} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
function WinningRateVersionCard({
  version,
}: {
  version: WinningRateVersionView;
}) {
  const label =
    version.version === "replacement-forex-v1"
      ? "Replacement Intelligence v1"
      : version.version === "forex-trading-combined-document-v2"
        ? "Replacement Intelligence v2"
        : version.version === "forex-trading-combined-document-v3"
          ? "Replacement Intelligence v3"
          : "Replacement Intelligence v5";
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 rounded-2xl border bg-card p-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
            Historical performance
          </p>
          <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight">
            {label}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Only signals generated by this exact intelligence version are
            included.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <SummaryStat
            label="Generated"
            value={version.overall.generated}
            tone="neutral"
          />
          <SummaryStat
            label="Resolved"
            value={version.overall.resolved}
            tone="neutral"
          />
          <SummaryStat label="Wins" value={version.overall.wins} tone="good" />
          <SummaryStat
            label="Losses"
            value={version.overall.losses}
            tone="bad"
          />
          <SummaryStat
            label="Win rate"
            value={version.overall.winRate ?? 0}
            tone="neutral"
          />
        </div>
      </div>
      <WinningRateTable
        title="By asset"
        rows={version.assets}
        keyLabel="Asset"
      />
      <WinningRateTable
        title="By asset and timeframe"
        rows={version.timeframes}
        keyLabel="Asset · timeframe"
      />
      <WinningRateTable
        title="By confidence band"
        rows={version.confidenceBands}
        keyLabel="Confidence band"
      />
      <WinningRateConfidenceGroups rows={version.confidenceByAssetTimeframe} />
    </div>
  );
}
function MacroStatusPanel() {
  const macro = trpc.intelligence.macroStatus.useQuery();
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="font-display text-lg">
          Official macro layer
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Free official-source context available to active v5. Missing or stale
          data never overrides the full v2 foundation.
        </p>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(macro.data ?? []).map(item => (
          <div key={item.asset} className="rounded-xl border bg-muted/10 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold">{item.asset}</p>
              <StatusPill status={item.context.status} />
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {item.context.summary}
            </p>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Observations: {item.context.observations?.length ?? 0} · Fetched:{" "}
              {item.context.fetchedAt
                ? formatDateTime(item.context.fetchedAt)
                : "—"}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
function V2V3Comparison({ versions }: { versions: WinningRateVersionView[] }) {
  const v2 = versions.find(
    version => version.version === "forex-trading-combined-document-v2"
  );
  const v3 = versions.find(
    version => version.version === "forex-trading-combined-document-v3"
  );
  const v5 = versions.find(
    version => version.version === "forex-trading-combined-document-v5"
  );
  if (!v2 && !v3) return null;
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="font-display text-lg">
          Version-separated paper comparison
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          These are descriptive paper records, not proof that a newer version is
          more accurate. V5 is now the active paper-signal model. Compare it
          with historical v3 records, but do not treat the comparison as proof
          of profitability.
        </p>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Replacement Intelligence v2
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <SummaryStat
              label="Generated"
              value={v2?.overall.generated ?? 0}
              tone="neutral"
            />
            <SummaryStat
              label="Resolved"
              value={v2?.overall.resolved ?? 0}
              tone="neutral"
            />
            <SummaryStat
              label="Win rate"
              value={v2?.overall.winRate ?? 0}
              tone="neutral"
            />
          </div>
        </div>
        <div className="rounded-xl border border-primary/20 bg-primary/[0.035] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            Replacement Intelligence v3
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <SummaryStat
              label="Generated"
              value={v3?.overall.generated ?? 0}
              tone="neutral"
            />
            <SummaryStat
              label="Resolved"
              value={v3?.overall.resolved ?? 0}
              tone="neutral"
            />
            <SummaryStat
              label="Win rate"
              value={v3?.overall.winRate ?? 0}
              tone="neutral"
            />
          </div>
        </div>
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">
            Replacement Intelligence v5 · active
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <SummaryStat
              label="Generated"
              value={v5?.overall.generated ?? 0}
              tone="neutral"
            />
            <SummaryStat
              label="Resolved"
              value={v5?.overall.resolved ?? 0}
              tone="neutral"
            />
            <SummaryStat
              label="Win rate"
              value={v5?.overall.winRate ?? 0}
              tone="neutral"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
function TimingMetricCells({
  metric,
}: {
  metric: {
    generated: number;
    resolved: number;
    takeProfitHits: number;
    stopLossHits: number;
    winRate: number | null;
  };
}) {
  return (
    <>
      <td className="whitespace-nowrap px-1.5 py-2 text-right">
        {metric.generated}
      </td>
      <td className="whitespace-nowrap px-1.5 py-2 text-right">
        {metric.resolved}
      </td>
      <td className="whitespace-nowrap px-1.5 py-2 text-right text-emerald-600">
        {metric.takeProfitHits}
      </td>
      <td className="whitespace-nowrap px-1.5 py-2 text-right text-rose-600">
        {metric.stopLossHits}
      </td>
      <td className="whitespace-nowrap px-1.5 py-2 text-right font-semibold text-primary">
        {metric.winRate === null ? "—" : `${metric.winRate}%`}
      </td>
    </>
  );
}
function intelligenceVersionLabel(version: string) {
  return version === "replacement-forex-v1"
    ? "Replacement Intelligence v1"
    : version === "forex-trading-combined-document-v2"
      ? "Replacement Intelligence v2"
      : version === "forex-trading-combined-document-v3"
        ? "Replacement Intelligence v3"
        : "Replacement Intelligence v5";
}
function LocatorOutcomeReviewCard() {
  const stats = trpc.intelligence.locatorV5OutcomeStats.useQuery(
    undefined,
    LIVE_QUERY_OPTIONS
  );
  const validation = stats.data?.validation;
  return (
    <Card className="mb-6 border-primary/20 bg-primary/[0.025]">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="font-display text-lg">
              Current Entry Locator v5 review
            </CardTitle>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Outcome evidence scoped only to signals emitted after the stateful
              entry-indicator locator became authoritative.
            </p>
          </div>
          <Badge className="border-primary/25 bg-primary/10 text-primary">
            ENTRY_LOCATOR_V5
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-5">
          <SummaryStat
            label="Generated"
            value={stats.data?.total ?? 0}
            tone="neutral"
          />
          <SummaryStat
            label="Resolved"
            value={validation?.resolved ?? 0}
            tone="neutral"
          />
          <SummaryStat
            label="TP wins"
            value={validation?.wins ?? 0}
            tone="good"
          />
          <SummaryStat
            label="SL losses"
            value={validation?.losses ?? 0}
            tone="bad"
          />
          <SummaryStat
            label="Win rate"
            value={validation?.winRate ?? 0}
            tone="neutral"
          />
        </div>
        <div className="mt-4 rounded-xl border border-dashed p-3 text-xs leading-5 text-muted-foreground">
          {validation?.reviewStatus === "READY_FOR_REVIEW"
            ? "The current locator-era sample has reached its configured review threshold."
            : `Collecting locator-era paper evidence (${validation?.resolved ?? 0}/${validation?.reviewThreshold ?? 50} resolved). No threshold or intelligence change is being made from this sample yet.`}
        </div>
      </CardContent>
    </Card>
  );
}
function TimingAnalyticsPage({ mode }: { mode: "hour" | "day" }) {
  const query =
    mode === "hour"
      ? trpc.intelligence.bestTimeToTradeStats.useQuery()
      : trpc.intelligence.bestDaysToTradeStats.useQuery();
  const title = mode === "hour" ? "Best Time to Trade" : "Best Days to Trade";
  const description =
    mode === "hour"
      ? "Paper-signal outcomes grouped by the UTC hour when each signal was generated."
      : "Paper-signal outcomes grouped by the UTC day when each signal was generated.";
  const groups = query.data?.groups ?? [];
  const visibleVersions = (query.data?.versions ?? []).filter(version =>
    groups.some(
      group =>
        group.version === version &&
        group.buckets.some(bucket => bucket.generated > 0)
    )
  );
  return (
    <>
      <PageHeading
        eyebrow="Timing intelligence"
        title={title}
        description={description}
      />
      {query.isError && (
        <DataError
          text={`${title} data could not be loaded. Refresh after the database connection recovers.`}
        />
      )}
      {query.isLoading ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Loading timing analytics…
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {visibleVersions.length ? (
            visibleVersions.map(version => (
              <section key={version}>
                <div className="mb-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
                    Version-separated paper history
                  </p>
                  <h2 className="mt-1 font-display text-2xl font-semibold">
                    {intelligenceVersionLabel(version)}
                  </h2>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  {groups
                    .filter(group => group.version === version)
                    .map(group => (
                      <Card
                        key={`${group.version}-${group.asset}-${group.timeframe}`}
                      >
                        <CardHeader className="pb-3">
                          <CardTitle className="font-display text-lg">
                            {group.asset} · {group.timeframe}
                          </CardTitle>
                          <p className="text-xs text-muted-foreground">
                            {mode === "hour"
                              ? "Every UTC hour"
                              : "Every weekday"}
                          </p>
                        </CardHeader>
                        <CardContent>
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[590px] table-fixed text-[11px]">
                              <colgroup>
                                <col className="w-[25%]" />
                                <col className="w-[14%]" />
                                <col className="w-[14%]" />
                                <col className="w-[14%]" />
                                <col className="w-[14%]" />
                                <col className="w-[19%]" />
                              </colgroup>
                              <thead>
                                <tr className="border-b text-left text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                                  <th className="whitespace-nowrap px-1.5 py-2">
                                    {mode === "hour" ? "Hour" : "Day"}
                                  </th>
                                  <th className="whitespace-nowrap px-1.5 py-2 text-right">
                                    Generated
                                  </th>
                                  <th className="whitespace-nowrap px-1.5 py-2 text-right">
                                    Resolved
                                  </th>
                                  <th className="whitespace-nowrap px-1.5 py-2 text-right">
                                    TP hits
                                  </th>
                                  <th className="whitespace-nowrap px-1.5 py-2 text-right">
                                    SL hits
                                  </th>
                                  <th className="whitespace-nowrap px-1.5 py-2 text-right">
                                    Win rate
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {group.buckets.map(bucket => (
                                  <tr
                                    key={bucket.key}
                                    className="border-b last:border-0"
                                  >
                                    <td className="px-3 py-2 font-medium">
                                      {bucket.label}
                                    </td>
                                    <TimingMetricCells metric={bucket} />
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                </div>
              </section>
            ))
          ) : (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                No persisted paper-signal records are available for the selected
                analytics scope.
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </>
  );
}

function WinningRatePage() {
  const stats = trpc.intelligence.winningRateStats.useQuery(
    undefined,
    LIVE_QUERY_OPTIONS
  );
  const excluded = trpc.intelligence.excludedWinningRateSignals.useQuery(
    undefined,
    { enabled: stats.data?.reconciliation?.status === "MISMATCH" }
  );
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showExcluded, setShowExcluded] = useState(false);
  const refresh = () => {
    void Promise.all([
      stats.refetch(),
      excluded.refetch(),
    ]);
  };
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh]);
  const visibleVersions = (stats.data?.versions ?? []).filter(
    version => version.overall.generated > 0
  );
  return (
    <>
      {stats.isError && (
        <DataError text="Winning Rate statistics could not be loaded. Refresh after the database connection recovers." />
      )}
      <PageHeading
        eyebrow="Performance ledger"
        title="Winning rate"
        description="Historical paper-signal outcomes separated by Replacement Intelligence version, asset, timeframe, and confidence band."
      />
      <WinningRateTelemetry
        stats={stats.data}
        excluded={excluded.data}
        isRefreshing={stats.isFetching || excluded.isFetching}
        autoRefresh={autoRefresh}
        showExcluded={showExcluded}
        onRefresh={refresh}
        onToggleAutoRefresh={() => setAutoRefresh(value => !value)}
        onToggleExcluded={() => setShowExcluded(value => !value)}
      />
      {visibleVersions.length ? (
        <div className="space-y-10">
          {visibleVersions.map(version => (
            <WinningRateVersionCard key={version.version} version={version} />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No persisted paper-signal records are available for the selected
            analytics scope.
          </CardContent>
        </Card>
      )}
    </>
  );
}
export default function Home() {
  const [location] = useLocation();
  const path = location.split("?")[0];
  const rules = trpc.rules.list.useQuery(undefined, { enabled: path === "/" });
  if (path === "/" && !rules.isLoading && !rules.data?.length)
    return <Onboarding />;
  const page =
    path === "/chat-audit" ? (
      <ChatAudit assistant="WHITE" />
    ) : path === "/cherry-ai" ? (
      <ChatAudit assistant="CHERRY" />
    ) : path === "/strategy-rules" ? (
      <RulesPage />
    ) : path === "/trade-history" ? (
      <TradeHistory />
    ) : path === "/scanner" ? (
      <ScannerPage />
    ) : path === "/monitoring" ? (
      <MonitoringPage />
    ) : path === "/winning-rate" ? (
      <WinningRatePage />
    ) : path === "/best-time-to-trade" ? (
      <TimingAnalyticsPage mode="hour" />
    ) : path === "/best-days-to-trade" ? (
      <TimingAnalyticsPage mode="day" />
    ) : (
      <Overview />
    );
  const immersiveChat = path === "/chat-audit" || path === "/cherry-ai";
  return (
    <DashboardLayout immersiveChat={immersiveChat}>
      <div className={immersiveChat ? "w-full" : "mx-auto w-full max-w-[1500px]"}>{page}</div>
    </DashboardLayout>
  );
}
