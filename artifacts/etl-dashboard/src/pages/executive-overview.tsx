import { Fragment, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useGetOverviewKpis,
  useGetPipelineRuns,
} from "@workspace/api-client-react";
import { useAccount } from "@/contexts/AccountContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import CloudWatchLogViewer from "@/components/CloudWatchLogViewer";
import {
  CheckCircle2,
  XCircle,
  Briefcase,
  Clock,
  DollarSign,
  Plus,
  Minus,
  AlertCircle,
  Cpu,
  FileText,
} from "lucide-react";

interface JobRun {
  id: string;
  pipelineName: string;
  status: string;
  startTime: string;
  endTime: string;
  duration: string;
  costPerRun: number;
}

interface LambdaRun {
  id: string;
  functionName: string;
  status: string;
  startTime: string;
  endTime: string;
  duration: string;
  costPerRun: number;
}

interface LambdaKpis {
  totalFunctions: number;
  healthy: number;
  withErrors: number;
}

interface RunHistoryItem {
  id: string;
  status: string;
  startTime: string;
  durationMin: number;
  cost: number;
  recordsProcessed: number;
  errorMessage: string | null;
}

const DATE_MULTIPLIERS: Record<string, number> = {
  today: 1,
  "7d": 7,
  "30d": 30,
  "60d": 60,
  "90d": 90,
};

function statusBadge(status: string) {
  const map: Record<string, string> = {
    Running: "bg-blue-100 text-blue-700 border-blue-200",
    Success: "bg-emerald-100 text-emerald-700 border-emerald-200",
    Failed: "bg-red-100 text-red-700 border-red-200",
    Delayed: "bg-amber-100 text-amber-700 border-amber-200",
    Waiting: "bg-slate-100 text-slate-600 border-slate-200",
    "Timed Out": "bg-orange-100 text-orange-700 border-orange-200",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${map[status] || map.Waiting}`}
    >
      {status}
    </span>
  );
}

function fmtTime(iso: string) {
  return iso
    ? new Date(iso).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
}

function fmtMs(ms: number) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function filterRunsByDateRange<T extends { startTime: string }>(
  runs: T[],
  dateRange: string,
): T[] {
  if (!Array.isArray(runs)) return [];
  const now = new Date();
  let cutoffTime: Date;

  switch (dateRange) {
    case "today":
      cutoffTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case "7d":
      cutoffTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case "30d":
      cutoffTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case "60d":
      cutoffTime = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
      break;
    case "90d":
      cutoffTime = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      break;
    default:
      return runs;
  }

  return runs.filter((run) => {
    try {
      const runTime = new Date(run.startTime);
      return runTime >= cutoffTime;
    } catch {
      return false;
    }
  });
}

interface JobHistorySubsectionProps {
  jobName: string;
  onAnalyzeLogs: (runId: string) => void;
}

interface JobHistorySubsectionProps {
  jobName: string;
  onAnalyzeLogs: (runId: string) => void;
}

function JobHistorySubsection({ jobName, onAnalyzeLogs }: JobHistorySubsectionProps) {
  const { data, isLoading } = useQuery<RunHistoryItem[]>({
    queryKey: ["pipeline-history", jobName],
    queryFn: async () => {
      const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
      const res = await fetch(`${base}/api/pipelines/history/${jobName}`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  if (isLoading || !data) {
    return (
      <div className="px-6 py-4 text-xs text-muted-foreground">
        Loading run history…
      </div>
    );
  }

  // Sort by start time descending (most recent first) and take last 5 runs
  const recentRuns = data
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
    .slice(0, 5);

  const totalCost = recentRuns.reduce((s, r) => s + r.cost, 0);
  const success = recentRuns.filter((r) => r.status === "Success").length;
  const successRate = recentRuns.length
    ? Math.round((success / recentRuns.length) * 100)
    : 0;
  const avgDur = recentRuns.length
    ? recentRuns.reduce((s, r) => s + r.durationMin, 0) / recentRuns.length
    : 0;

  return (
    <div className="bg-slate-50 border-t border-b">
      <div className="px-6 py-3 border-b bg-white/60 flex items-center gap-6 text-xs">
        <span className="font-mono text-slate-700">{jobName}</span>
        <span className="text-muted-foreground">
          Success rate:{" "}
          <span className="font-semibold text-slate-700">{successRate}%</span>
        </span>
        <span className="text-muted-foreground">
          Avg duration:{" "}
          <span className="font-semibold text-slate-700">
            {avgDur.toFixed(1)}m
          </span>
        </span>
        <span className="text-muted-foreground">
          Total cost (last 5 runs):{" "}
          <span className="font-semibold text-slate-700">
            ${totalCost.toFixed(2)}
          </span>
        </span>
      </div>
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-100/60 hover:bg-slate-100/60">
            <TableHead className="text-[11px] uppercase tracking-wide text-slate-500">
              Run ID
            </TableHead>
            <TableHead className="text-[11px] uppercase tracking-wide text-slate-500">
              Status
            </TableHead>
            <TableHead className="text-[11px] uppercase tracking-wide text-slate-500">
              Start Time
            </TableHead>
            <TableHead className="text-[11px] uppercase tracking-wide text-slate-500">
              Duration
            </TableHead>
            <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 text-right">
              Cost
            </TableHead>
            <TableHead className="text-[11px] uppercase tracking-wide text-slate-500">
              Error
            </TableHead>
            <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 text-center">
              Logs
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {recentRuns.map((r) => (
            <TableRow key={r.id} className="hover:bg-white">
              <TableCell className="text-xs font-mono text-muted-foreground">
                {r.id}
              </TableCell>
              <TableCell>{statusBadge(r.status)}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {new Date(r.startTime).toLocaleString([], {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </TableCell>
              <TableCell className="text-xs">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  {r.durationMin.toFixed(1)}m
                </span>
              </TableCell>
              <TableCell className="text-xs text-right font-mono">
                ${r.cost.toFixed(2)}
              </TableCell>
              <TableCell className="text-[11px] text-red-600 font-mono max-w-[280px] truncate">
                {r.errorMessage ? (
                  <span className="flex items-center gap-1">
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    <span className="truncate" title={r.errorMessage}>
                      {r.errorMessage}
                    </span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-center">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => onAnalyzeLogs(r.id)}
                >
                  <FileText className="h-3 w-3 mr-1" />
                  Analyze
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

interface LambdaHistoryItem {
  id: string;
  status: string;
  startTime: string;
  durationMs: number;
  cost: number;
  memoryMb: number;
  errorMessage: string | null;
}

interface LambdaHistorySubsectionProps {
  functionName: string;
  onAnalyzeLogs: (invocationId: string) => void;
}

interface LambdaHistorySubsectionProps {
  functionName: string;
  onAnalyzeLogs: (invocationId: string) => void;
}

function LambdaHistorySubsection({ functionName, onAnalyzeLogs }: LambdaHistorySubsectionProps) {
  const { data, isLoading } = useQuery<LambdaHistoryItem[]>({
    queryKey: ["lambda-history", functionName],
    queryFn: async () => {
      const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
      const res = await fetch(`${base}/api/lambdas/history/${functionName}`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  if (isLoading || !data) {
    return (
      <div className="px-6 py-4 text-xs text-muted-foreground">
        Loading invocation history…
      </div>
    );
  }

  // Sort by start time descending (most recent first) and take last 5 runs
  const recentRuns = data
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
    .slice(0, 5);

  const totalCost = recentRuns.reduce((s, r) => s + r.cost, 0);
  const success = recentRuns.filter((r) => r.status === "Success").length;
  const successRate = recentRuns.length
    ? Math.round((success / recentRuns.length) * 100)
    : 0;
  const avgMs = recentRuns.length
    ? recentRuns.reduce((s, r) => s + r.durationMs, 0) / recentRuns.length
    : 0;

  return (
    <div className="bg-slate-50 border-t border-b">
      <div className="px-6 py-3 border-b bg-white/60 flex items-center gap-6 text-xs">
        <span className="font-mono text-slate-700">{functionName}</span>
        <span className="text-muted-foreground">
          Success rate:{" "}
          <span className="font-semibold text-slate-700">{successRate}%</span>
        </span>
        <span className="text-muted-foreground">
          Avg duration:{" "}
          <span className="font-semibold text-slate-700">
            {fmtMs(Math.round(avgMs))}
          </span>
        </span>
        <span className="text-muted-foreground">
          Total cost (last 5 runs):{" "}
          <span className="font-semibold text-slate-700">
            ${totalCost.toFixed(4)}
          </span>
        </span>
      </div>
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-100/60 hover:bg-slate-100/60">
            <TableHead className="text-[11px] uppercase tracking-wide text-slate-500">
              Invocation ID
            </TableHead>
            <TableHead className="text-[11px] uppercase tracking-wide text-slate-500">
              Status
            </TableHead>
            <TableHead className="text-[11px] uppercase tracking-wide text-slate-500">
              Start Time
            </TableHead>
            <TableHead className="text-[11px] uppercase tracking-wide text-slate-500">
              Duration
            </TableHead>
            <TableHead className="text-[11px] uppercase tracking-wide text-slate-500">
              Memory
            </TableHead>
            <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 text-right">
              Cost
            </TableHead>
            <TableHead className="text-[11px] uppercase tracking-wide text-slate-500">
              Error
            </TableHead>
            <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 text-center">
              Logs
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {recentRuns.map((r) => (
            <TableRow key={r.id} className="hover:bg-white">
              <TableCell className="text-xs font-mono text-muted-foreground">
                {r.id}
              </TableCell>
              <TableCell>{statusBadge(r.status)}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {new Date(r.startTime).toLocaleString([], {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </TableCell>
              <TableCell className="text-xs">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  {fmtMs(r.durationMs)}
                </span>
              </TableCell>
              <TableCell className="text-xs">
                <span className="flex items-center gap-1">
                  <Cpu className="h-3 w-3 text-muted-foreground" />
                  {r.memoryMb} MB
                </span>
              </TableCell>
              <TableCell className="text-xs text-right font-mono">
                ${r.cost.toFixed(4)}
              </TableCell>
              <TableCell className="text-[11px] text-red-600 font-mono max-w-[280px] truncate">
                {r.errorMessage ? (
                  <span className="flex items-center gap-1">
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    <span className="truncate" title={r.errorMessage}>
                      {r.errorMessage}
                    </span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-center">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => onAnalyzeLogs(r.id)}
                >
                  <FileText className="h-3 w-3 mr-1" />
                  Analyze
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function ExecutiveOverview() {
  const { data: kpis } = useGetOverviewKpis();
  const { data: runs } = useGetPipelineRuns();
  const { account } = useAccount();
  const accountScale = account.scale;
  const [dateRange, setDateRange] = useState("today");
  const [resourceType, setResourceType] = useState<"job" | "lambda">("job");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [logsModalOpen, setLogsModalOpen] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedJobName, setSelectedJobName] = useState<string | null>(null);

  // Reset expansion when switching account
  useEffect(() => {
    setExpanded(null);
  }, [account.id]);

  const [lambdaKpis, setLambdaKpis] = useState<LambdaKpis | null>(null);
  const [lambdaRuns, setLambdaRuns] = useState<LambdaRun[]>([]);

  useEffect(() => {
    if (resourceType !== "lambda") return;
    const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
    Promise.all([
      fetch(`${base}/api/lambdas/kpis`).then((r) => r.json()),
      fetch(`${base}/api/lambdas/runs`).then((r) => r.json()),
    ])
      .then(([k, r]) => {
        setLambdaKpis(k);
        setLambdaRuns(r);
      })
      .catch(() => {
        setLambdaKpis(null);
        setLambdaRuns([]);
      });
  }, [resourceType]);

  // Reset expansion when switching resource types
  useEffect(() => {
    setExpanded(null);
  }, [resourceType]);

  if (!kpis)
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Loading...
      </div>
    );

  const mult = (DATE_MULTIPLIERS[dateRange] ?? 1) * accountScale;
  const isLambda = resourceType === "lambda";

  const jobRuns: JobRun[] = (
    Array.isArray(runs) ? runs : []
  ) as JobRun[];

  // Filter runs by date range
  const filteredJobRuns = filterRunsByDateRange(jobRuns, dateRange);
  const filteredLambdaRuns = filterRunsByDateRange(lambdaRuns, dateRange);

  // Calculate counts from unique jobs/functions (after grouping)
  const uniqueResources = isLambda
    ? new Set(filteredLambdaRuns.map(r => r.functionName)).size
    : new Set(filteredJobRuns.map(r => r.pipelineName)).size;

  let totalCount: number;
  let healthyCount: number;
  let failedCount: number;

  if (uniqueResources === 0) {
    // No resources in selected period - show 0 in tiles
    totalCount = 0;
    healthyCount = 0;
    failedCount = 0;
  } else {
    // Calculate from unique resources for all date ranges
    totalCount = uniqueResources;
    // For healthy/failed counts, we need to check the latest run status for each unique resource
    const latestRuns = isLambda
      ? (() => {
          const grouped = filteredLambdaRuns.reduce((acc, run) => {
            const key = run.functionName;
            if (!acc[key] || new Date(run.startTime) > new Date(acc[key].startTime)) {
              acc[key] = run;
            }
            return acc;
          }, {} as Record<string, LambdaRun>);
          return Object.values(grouped);
        })()
      : (() => {
          const grouped = filteredJobRuns.reduce((acc, run) => {
            const key = run.pipelineName;
            if (!acc[key] || new Date(run.startTime) > new Date(acc[key].startTime)) {
              acc[key] = run;
            }
            return acc;
          }, {} as Record<string, JobRun>);
          return Object.values(grouped);
        })();

    healthyCount = latestRuns.filter((r) => r.status === "Success").length;
    failedCount = latestRuns.filter((r) => r.status === "Failed" || r.status === "Timed Out").length;
  }

  const totalLabel = isLambda ? "Total Functions" : "Total Jobs";
  const healthyLabel = isLambda ? "Healthy Functions" : "Healthy Jobs";
  const failedLabel = isLambda ? "Functions with Errors" : "Failed Jobs";
  const totalSubtitle = isLambda
    ? "Across all Lambda functions"
    : "Across all Glue jobs";
  const tableTitle = isLambda ? "Active Invocations" : "Active Jobs";
  const nameHeader = isLambda ? "Function Name" : "Job Name";
  const costHeader = isLambda ? "Cost/Invocation" : "Cost/Run";

  type Row = {
    id: string;
    name: string;
    status: string;
    startTime: string;
    endTime: string;
    duration: string;
    cost: number;
    expandable: boolean;
  };
  const allRows: Row[] = isLambda
    ? (() => {
        // Group Lambda runs by function name and keep only the latest run for each
        const grouped = filteredLambdaRuns.reduce((acc, run) => {
          const key = run.functionName;
          if (!acc[key] || new Date(run.startTime) > new Date(acc[key].startTime)) {
            acc[key] = run;
          }
          return acc;
        }, {} as Record<string, LambdaRun>);
        return Object.values(grouped).map((r) => ({
          id: r.id,
          name: r.functionName,
          status: r.status,
          startTime: r.startTime,
          endTime: r.endTime,
          duration: r.duration,
          cost: r.costPerRun,
          expandable: true,
        }));
      })()
    : (() => {
        // Group job runs by pipeline name and keep only the latest run for each
        const grouped = filteredJobRuns.reduce((acc, run) => {
          const key = run.pipelineName;
          if (!acc[key] || new Date(run.startTime) > new Date(acc[key].startTime)) {
            acc[key] = run;
          }
          return acc;
        }, {} as Record<string, JobRun>);
        return Object.values(grouped).map((r) => ({
          id: r.id,
          name: r.pipelineName,
          status: r.status,
          startTime: r.startTime,
          endTime: r.endTime,
          duration: r.duration,
          cost: r.costPerRun,
          expandable: true,
        }));
      })();
  // Slice rows proportional to selected account so the table reflects the scope
  const rowKeep =
    account.id === "all"
      ? allRows.length
      : Math.max(1, Math.ceil(allRows.length * accountScale));
  const rows: Row[] = allRows.slice(0, rowKeep);

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] gap-3">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-xl font-bold tracking-tight">
            Executive Overview
          </h2>
          <p className="text-xs text-muted-foreground">
            {isLambda
              ? "Lambda function health and key performance indicators"
              : "Job health and key performance indicators"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={resourceType}
            onValueChange={(v) => setResourceType(v as "job" | "lambda")}
          >
            <SelectTrigger className="h-8 w-[130px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="job">Jobs</SelectItem>
              <SelectItem value="lambda">Lambda</SelectItem>
            </SelectContent>
          </Select>
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="h-8 w-[130px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="7d">Last 7 Days</SelectItem>
              <SelectItem value="30d">Last 30 Days</SelectItem>
              <SelectItem value="60d">Last 60 Days</SelectItem>
              <SelectItem value="90d">Last 90 Days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPI tiles - frozen */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 shrink-0">
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  {totalLabel}
                </p>
                <p className="text-2xl font-bold text-slate-800 leading-tight">
                  {totalCount.toLocaleString()}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {totalSubtitle}
                </p>
              </div>
              <div className="p-2 rounded-lg bg-blue-50">
                <Briefcase className="h-5 w-5 text-blue-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  {healthyLabel}
                </p>
                <p className="text-2xl font-bold text-emerald-600 leading-tight">
                  {healthyCount.toLocaleString()}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {totalCount > 0
                    ? Math.round((healthyCount / totalCount) * 100)
                    : 0}
                  % success rate
                </p>
              </div>
              <div className="p-2 rounded-lg bg-emerald-50">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  {failedLabel}
                </p>
                <p className="text-2xl font-bold text-red-600 leading-tight">
                  {failedCount.toLocaleString()}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {totalCount > 0
                    ? Math.round((failedCount / totalCount) * 100)
                    : 0}
                  % failure rate
                </p>
              </div>
              <div className="p-2 rounded-lg bg-red-50">
                <XCircle className="h-5 w-5 text-red-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Active Jobs - fills remaining height, scrolls internally */}
      <Card className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <CardHeader className="pb-2 pt-3 shrink-0">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">{tableTitle}</CardTitle>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />{" "}
                Running
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />{" "}
                Success
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />{" "}
                Failed
              </span>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0 flex-1 min-h-0 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_rgb(226_232_240)]">
              <TableRow>
                <TableHead className="w-8 text-xs"></TableHead>
                <TableHead className="text-xs">{nameHeader}</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Start Time</TableHead>
                <TableHead className="text-xs">End Time</TableHead>
                <TableHead className="text-xs">Duration</TableHead>
                <TableHead className="text-xs text-right">
                  <span className="flex items-center justify-end gap-1">
                    <DollarSign className="h-3 w-3" />
                    {costHeader}
                  </span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8">
                    <div className="flex items-center justify-center text-muted-foreground text-sm">
                      {dateRange === "today"
                        ? `No ${isLambda ? "invocations" : "jobs"} run today`
                        : `No ${isLambda ? "invocations" : "jobs"} in selected period`}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const isExpanded = expanded === row.name;
                  return (
                    <Fragment key={row.id}>
                      <TableRow
                        className={`group ${row.expandable ? "cursor-pointer" : ""} ${isExpanded ? "bg-slate-50" : ""}`}
                        onClick={() =>
                          row.expandable &&
                          setExpanded(isExpanded ? null : row.name)
                        }
                      >
                        <TableCell className="py-2">
                          {row.expandable ? (
                            <button
                              type="button"
                              aria-label={
                                isExpanded ? "Collapse details" : "Expand details"
                              }
                              className="flex items-center justify-center h-5 w-5 rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpanded(isExpanded ? null : row.name);
                              }}
                            >
                              {isExpanded ? (
                                <Minus className="h-3 w-3" />
                              ) : (
                                <Plus className="h-3 w-3" />
                              )}
                            </button>
                          ) : null}
                        </TableCell>
                        <TableCell className="py-2">
                          <span
                            className={`text-xs font-medium ${row.expandable ? "text-primary" : "text-slate-700"}`}
                          >
                            {row.name}
                          </span>
                        </TableCell>
                        <TableCell className="py-2">
                          {statusBadge(row.status)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground py-2">
                          {fmtTime(row.startTime)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground py-2">
                          {fmtTime(row.endTime)}
                        </TableCell>
                        <TableCell className="text-xs py-2">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3 text-muted-foreground" />
                            {row.duration}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-right font-mono py-2">
                          {row.cost > 0 ? (
                            <span className="font-medium text-slate-700">
                              $
                              {isLambda
                                ? row.cost.toFixed(4)
                                : row.cost.toFixed(2)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                      {isExpanded && row.expandable && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={7} className="p-0">
                            {isLambda ? (
                              <LambdaHistorySubsection 
                                functionName={row.name}
                                onAnalyzeLogs={(invocationId) => {
                                  setSelectedJobId(invocationId);
                                  setSelectedJobName(row.name);
                                  setLogsModalOpen(true);
                                }}
                              />
                            ) : (
                              <JobHistorySubsection 
                                jobName={row.name}
                                onAnalyzeLogs={(runId) => {
                                  setSelectedJobId(runId);
                                  setSelectedJobName(row.name);
                                  setLogsModalOpen(true);
                                }}
                              />
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* CloudWatch Log Viewer Modal */}
      <CloudWatchLogViewer
        jobId={selectedJobId}
        jobName={selectedJobName}
        resourceType={resourceType}
        open={logsModalOpen}
        onClose={() => {
          setLogsModalOpen(false);
          setSelectedJobId(null);
          setSelectedJobName(null);
        }}
      />
    </div>
  );
}
