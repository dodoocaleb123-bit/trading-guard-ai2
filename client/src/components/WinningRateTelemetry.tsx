import { ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type DateValue = Date | string | null | undefined;

type WinningRateStats = {
  generatedAt?: DateValue;
  reconciliation?: {
    sourceTotal: number;
    includedTotal: number;
    excludedTotal: number;
    status: "RECONCILED" | "MISMATCH";
  };
};

type ExcludedSignal = {
  id: number;
  asset: string;
  timeframe: string;
  direction: string;
  entry: string | number | null;
  stopLoss: string | number | null;
  takeProfit: string | number | null;
  confidence: string | number | null;
  status: string;
  intelligenceVersion: string | null;
  openedAt: DateValue;
  closedAt: DateValue;
};

type WinningRateTelemetryProps = {
  stats: WinningRateStats | undefined;
  excluded: ExcludedSignal[] | undefined;
  isRefreshing: boolean;
  autoRefresh: boolean;
  showExcluded: boolean;
  onRefresh: () => void;
  onToggleAutoRefresh: () => void;
  onToggleExcluded: () => void;
};

function formatDateTime(value: DateValue) {
  return value ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—";
}

export function WinningRateTelemetry({ stats, excluded, isRefreshing, autoRefresh, showExcluded, onRefresh, onToggleAutoRefresh, onToggleExcluded }: WinningRateTelemetryProps) {
  const reconciliation = stats?.reconciliation;
  const hasMismatch = reconciliation?.status === "MISMATCH";
  return <>
    <div className="mb-6 grid gap-3 xl:grid-cols-3">
      <Card className="border-primary/15 bg-primary/[0.025]">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2"><RefreshCw className={`h-4 w-4 text-primary ${isRefreshing ? "animate-spin" : ""}`} /><p className="font-medium text-sm">Analytics freshness</p></div>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" className="h-8 px-2 text-xs" onClick={onRefresh} disabled={isRefreshing} aria-label="Refresh analytics"><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh</Button>
              <Button type="button" size="sm" variant={autoRefresh ? "default" : "outline"} className="h-8 px-2 text-xs" onClick={onToggleAutoRefresh} aria-pressed={autoRefresh}>{autoRefresh ? "Auto on" : "Auto off"}</Button>
            </div>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">Last updated {formatDateTime(stats?.generatedAt)} · {reconciliation?.includedTotal ?? 0} recognized-version records included.</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Automatic refresh runs every 60 seconds while enabled.</p>
        </CardContent>
      </Card>
      <Card className={hasMismatch ? "border-amber-500/25 bg-amber-500/10" : "border-emerald-500/20 bg-emerald-500/5"}>
        <CardContent className="p-4"><div className="flex items-center justify-between gap-3"><div><p className={`font-medium text-sm ${hasMismatch ? "text-amber-800" : "text-emerald-700"}`}>{hasMismatch ? "Version-count reconciliation" : "Version counts reconciled"}</p><p className={`mt-1 text-xs leading-5 ${hasMismatch ? "text-amber-800/80" : "text-emerald-700/80"}`}>{hasMismatch ? `${reconciliation?.excludedTotal ?? 0} record${reconciliation?.excludedTotal === 1 ? "" : "s"} fall outside the v1–v7 analytics set.` : "All source records belong to a recognized analytics version."}</p></div>{hasMismatch && <Button type="button" size="sm" variant="outline" className="h-8 shrink-0 border-amber-500/30 bg-transparent px-2 text-xs text-amber-800 hover:bg-amber-500/10" onClick={onToggleExcluded}>{showExcluded ? <ChevronUp className="mr-1 h-3.5 w-3.5" /> : <ChevronDown className="mr-1 h-3.5 w-3.5" />}{showExcluded ? "Hide" : "Inspect"}</Button>}</div></CardContent>
      </Card>
    </div>
    {hasMismatch && showExcluded && <Card className="mb-6 border-amber-500/25"><CardHeader><CardTitle className="font-display text-lg">Excluded records</CardTitle><p className="text-xs leading-5 text-muted-foreground">These records remain in the database but are outside the recognized v1–v7 analytics version set. Showing the latest {excluded?.length ?? 0} records.</p></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-xs"><thead><tr className="border-b text-left uppercase tracking-[0.12em] text-muted-foreground"><th className="px-3 py-2">Opened</th><th className="px-3 py-2">Asset · TF</th><th className="px-3 py-2">Direction</th><th className="px-3 py-2">Entry</th><th className="px-3 py-2">Stop</th><th className="px-3 py-2">Target</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Version</th></tr></thead><tbody>{excluded?.map((signal) => <tr key={signal.id} className="border-b last:border-0"><td className="whitespace-nowrap px-3 py-2">{formatDateTime(signal.openedAt)}</td><td className="px-3 py-2 font-medium">{signal.asset} · {signal.timeframe}</td><td className="px-3 py-2">{signal.direction}</td><td className="px-3 py-2">{signal.entry ?? "—"}</td><td className="px-3 py-2">{signal.stopLoss ?? "—"}</td><td className="px-3 py-2">{signal.takeProfit ?? "—"}</td><td className="px-3 py-2">{signal.status}</td><td className="max-w-[220px] truncate px-3 py-2" title={signal.intelligenceVersion ?? "NULL"}>{signal.intelligenceVersion ?? "NULL"}</td></tr>)}</tbody></table></div>{!excluded?.length && <p className="text-sm text-muted-foreground">No excluded records were returned.</p>}</CardContent></Card>}
  </>;
}
