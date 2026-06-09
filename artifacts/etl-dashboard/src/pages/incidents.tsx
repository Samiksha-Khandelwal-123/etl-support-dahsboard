import { Fragment, useState } from "react";
import { useAccount } from "@/contexts/AccountContext";
import {
  useGetIncidentSummary,
  useGetActiveIncidents,
  useGetRepeatIncidents,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  Plus,
  Minus,
  AlertTriangle,
  Clock,
  User,
  CheckCircle2,
  Circle,
  FileSearch,
  Lightbulb,
} from "lucide-react";

interface Incident {
  id: string;
  title: string;
  severity: string;
  status: string;
  pipeline: string;
  domain?: string;
  createdAt: string;
  owner: string;
  acknowledged: boolean;
  escalationLevel: number;
  age: string;
}

const SEVERITY_BADGE: Record<string, string> = {
  P1: "bg-red-100 text-red-700 border-red-200",
  P2: "bg-amber-100 text-amber-700 border-amber-200",
  P3: "bg-blue-100 text-blue-700 border-blue-200",
  P4: "bg-slate-100 text-slate-600 border-slate-200",
};

const STATUS_BADGE: Record<string, string> = {
  Open: "bg-red-100 text-red-700 border-red-200",
  Investigating: "bg-blue-100 text-blue-700 border-blue-200",
  Mitigating: "bg-amber-100 text-amber-700 border-amber-200",
  Monitoring: "bg-purple-100 text-purple-700 border-purple-200",
  Resolved: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

const STATUS_COLOR: Record<string, string> = {
  Open: "#ef4444",
  Investigating: "#3b82f6",
  Mitigating: "#f59e0b",
  Monitoring: "#8b5cf6",
  Resolved: "#10b981",
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function statusBadge(status: string) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${STATUS_BADGE[status] || STATUS_BADGE.Open}`}>
      {status}
    </span>
  );
}

function severityBadge(sev: string) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold border ${SEVERITY_BADGE[sev] || SEVERITY_BADGE.P3}`}>
      {sev}
    </span>
  );
}

const TIMELINE_STAGES = ["Detected", "Acknowledged", "Investigating", "Mitigating", "Monitoring", "Resolved"];

function HorizontalTimeline({ incident }: { incident: Incident }) {
  // Determine current stage index from incident status
  const statusToStageIdx: Record<string, number> = {
    Open: incident.acknowledged ? 1 : 0,
    Investigating: 2,
    Mitigating: 3,
    Monitoring: 4,
    Resolved: 5,
  };
  const currentIdx = statusToStageIdx[incident.status] ?? 0;

  // Compute relative stage timestamps based on createdAt
  const created = new Date(incident.createdAt).getTime();
  const stageOffsetsMin = [0, 8, 22, 55, 95, 140];
  const stageTimes = stageOffsetsMin.map((m) => new Date(created + m * 60_000));

  return (
    <div className="rounded-md border bg-white p-4">
      <div className="flex items-center gap-2 mb-4">
        <Clock className="h-4 w-4 text-slate-400" />
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Incident Timeline</p>
      </div>
      <div className="relative">
        {/* Connecting line */}
        <div className="absolute top-3 left-0 right-0 h-0.5 bg-slate-200" aria-hidden />
        <div
          className="absolute top-3 left-0 h-0.5 bg-emerald-400 transition-all"
          style={{ width: `${(Math.min(currentIdx, TIMELINE_STAGES.length - 1) / (TIMELINE_STAGES.length - 1)) * 100}%` }}
          aria-hidden
        />

        {/* Stage markers */}
        <div className="relative grid grid-cols-6">
          {TIMELINE_STAGES.map((stage, i) => {
            const state: "done" | "active" | "pending" =
              i < currentIdx ? "done" : i === currentIdx ? "active" : "pending";
            const dotClasses =
              state === "done"
                ? "bg-emerald-500 border-emerald-500 text-white"
                : state === "active"
                ? "bg-blue-500 border-blue-500 text-white ring-4 ring-blue-100"
                : "bg-white border-slate-300 text-slate-300";
            return (
              <div key={stage} className="flex flex-col items-center text-center px-1">
                <div className={`relative z-10 flex items-center justify-center w-6 h-6 rounded-full border-2 ${dotClasses}`}>
                  {state === "done" ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <Circle className="h-2 w-2 fill-current" />
                  )}
                </div>
                <p
                  className={`mt-2 text-[11px] font-medium ${
                    state === "active"
                      ? "text-blue-700"
                      : state === "done"
                      ? "text-slate-700"
                      : "text-slate-400"
                  }`}
                >
                  {stage}
                </p>
                <p className={`text-[10px] mt-0.5 ${state === "pending" ? "text-slate-300" : "text-muted-foreground"}`}>
                  {state === "pending"
                    ? "—"
                    : stageTimes[i].toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function IncidentDetailSubsection({ incident }: { incident: Incident }) {
  const { data: repeats } = useGetRepeatIncidents();

  const rcaEntry = repeats?.find((r: { pipeline: string }) => r.pipeline === incident.pipeline);
  const isResolved = incident.status === "Resolved";

  const daysOpen = rcaEntry?.lastOccurrence ? Math.floor((Date.now() - new Date(rcaEntry.lastOccurrence).getTime()) / (1000 * 60 * 60 * 24)) : 2;

  const rcaSummary = rcaEntry?.rootCause ||
    (isResolved
      ? "A schema mismatch introduced during the latest upstream release caused repeated job failures until the pipeline was rolled back and the source contract was corrected."
      : "Investigation in progress. Initial analysis points to an upstream change introducing unexpected payload variance; on-call team is collecting trace data and validating recent deployments.");

  return (
    <div className="bg-slate-50 border-t border-b">
      {/* Top strip */}
      <div className="px-6 py-3 border-b bg-white/60 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs">
        <span className="font-mono text-slate-700">{incident.id}</span>
        <span className="text-muted-foreground">
          Pipeline: <span className="font-mono font-semibold text-slate-700">{incident.pipeline}</span>
        </span>
        <span className="text-muted-foreground">
          Detected: <span className="font-semibold text-slate-700">{fmt(incident.createdAt)}</span>
        </span>
        <span className="text-muted-foreground">
          Aging: <span className="font-semibold text-slate-700">{incident.age}</span>
        </span>
        <span className="text-muted-foreground">
          Days open: <span className="font-semibold text-slate-700">{daysOpen}d</span>
        </span>
        <span className="text-muted-foreground">
          Owner: <span className="font-semibold text-slate-700">{incident.owner}</span>
        </span>
      </div>

      {/* Body */}
      <div className="px-6 py-4 space-y-4">
        {/* Horizontal timeline */}
        <HorizontalTimeline incident={incident} />

        {/* RCA + Key Findings - 2 columns */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
          <div className="rounded-md border bg-white p-3 space-y-2 h-full">
            <div className="flex items-center gap-2">
              <FileSearch className="h-4 w-4 text-slate-400" />
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Root Cause Analysis</p>
            </div>
            <p className="text-sm text-slate-700 leading-6">{rcaSummary}</p>
          </div>
          <div className="rounded-md border bg-white p-3 space-y-2 h-full">
            <div className="flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Key Findings</p>
            </div>
            <ul className="text-xs text-slate-700 list-disc pl-5 space-y-1.5 leading-5">
              <li>Upstream schema drift introduced an unexpected field change.</li>
              <li>Validation rules did not fail fast before the transformation step.</li>
              <li>Retry behavior amplified the impact by repeatedly reprocessing failed batches.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Incidents() {
  const { data: summary } = useGetIncidentSummary();
  const { data: incidents } = useGetActiveIncidents();
  const { account } = useAccount();
  const accountScale = account.scale;
  const [dateRange, setDateRange] = useState("today");
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!summary) return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading...</div>;

  const mult = (dateRange === "30d" ? 30 : dateRange === "7d" ? 7 : 1) * accountScale;
  const scaled = {
    p1: Math.max(0, Math.round(summary.openByP1 * mult * 0.8)),
    p2: Math.max(0, Math.round(summary.openByP2 * mult * 0.9)),
    p3: Math.max(0, Math.round(summary.openByP3 * mult)),
    p4: Math.max(0, Math.round(summary.openByP4 * mult)),
  };

  const priorityData = [
    { name: "P1", count: scaled.p1, fill: "#ef4444" },
    { name: "P2", count: scaled.p2, fill: "#f59e0b" },
    { name: "P3", count: scaled.p3, fill: "#3b82f6" },
    { name: "P4", count: scaled.p4, fill: "#94a3b8" },
  ];

  // Use fetched incidents data
  const incidentRows: Incident[] = (incidents as Incident[] | undefined) ?? [];
  // Slice incidents proportional to selected account
  const rowKeep = account.id === "all" ? incidentRows.length : Math.max(1, Math.ceil(incidentRows.length * accountScale));
  const displayedIncidents: Incident[] = incidentRows.slice(0, rowKeep);

  // Status pie data — count incidents grouped by status
  const statusCounts = displayedIncidents.reduce<Record<string, number>>((acc, inc) => {
    acc[inc.status] = (acc[inc.status] || 0) + 1;
    return acc;
  }, {});
  const statusOrder = ["Open", "Investigating", "Mitigating", "Monitoring", "Resolved"];
  const statusData = statusOrder
    .filter((s) => statusCounts[s])
    .map((s) => ({ name: s, value: statusCounts[s], fill: STATUS_COLOR[s] }));
  const totalIncidents = statusData.reduce((s, d) => s + d.value, 0);

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] gap-3">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Incident Center</h2>
          <p className="text-xs text-muted-foreground">Active incidents and SLA tracking</p>
        </div>
        <Select value={dateRange} onValueChange={setDateRange}>
          <SelectTrigger className="h-8 w-[130px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="7d">Last 7 Days</SelectItem>
            <SelectItem value="30d">Last 30 Days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Charts row - frozen */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 shrink-0">
        <Card>
          <CardHeader className="pb-1 pt-3">
            <CardTitle className="text-sm font-medium">Incidents by Status</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 pb-3">
            <div className="grid grid-cols-[1fr_auto] items-center gap-3" style={{ height: 200 }}>
              <div className="relative h-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                    <Pie
                      data={statusData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={85}
                      paddingAngle={2}
                      stroke="#fff"
                      strokeWidth={2}
                      isAnimationActive={false}
                    >
                      {statusData.map((d) => (
                        <Cell key={d.name} fill={d.fill} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number, n: string) => [v, n]} contentStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <p className="text-2xl font-bold text-slate-800 leading-none">{totalIncidents}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-1">Total</p>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 pr-2">
                {statusData.map((d) => (
                  <div key={d.name} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: d.fill }} />
                    <span className="text-slate-700">{d.name}</span>
                    <span className="text-muted-foreground ml-auto font-mono">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1 pt-3">
            <CardTitle className="text-sm font-medium">Open Incidents by Priority</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 pb-3">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={priorityData} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 11 }} cursor={{ fill: "#f1f5f9" }} />
                <Bar dataKey="count" name="Open Incidents" radius={[4, 4, 0, 0]}>
                  {priorityData.map((d) => (
                    <Cell key={d.name} fill={d.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Active Incidents table - sliding window with sticky header */}
      <Card className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <CardHeader className="pb-2 pt-3 shrink-0">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">Active Incidents</CardTitle>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Open
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> Investigating
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Resolved
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0 flex-1 min-h-0 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_rgb(226_232_240)]">
              <TableRow>
                <TableHead className="w-8 text-xs"></TableHead>
                <TableHead className="text-xs">ID</TableHead>
                <TableHead className="text-xs">Title</TableHead>
                <TableHead className="text-xs">Priority</TableHead>
                <TableHead className="text-xs">Pipeline</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Age</TableHead>
                <TableHead className="text-xs">Owner</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayedIncidents.map((inc) => {
                const isExpanded = expanded === inc.id;
                return (
                  <Fragment key={inc.id}>
                    <TableRow
                      className={`group cursor-pointer ${isExpanded ? "bg-slate-50" : ""}`}
                      onClick={() => setExpanded(isExpanded ? null : inc.id)}
                    >
                      <TableCell className="py-2">
                        <button
                          type="button"
                          aria-label={isExpanded ? "Collapse details" : "Expand details"}
                          className="flex items-center justify-center h-5 w-5 rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                          onClick={(e) => { e.stopPropagation(); setExpanded(isExpanded ? null : inc.id); }}
                        >
                          {isExpanded ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                        </button>
                      </TableCell>
                      <TableCell className="text-xs font-mono text-primary py-2">{inc.id}</TableCell>
                      <TableCell className="py-2">
                        <span className="flex items-center gap-1.5 text-xs font-medium text-slate-700 max-w-[280px]">
                          {inc.severity === "P1" && <AlertTriangle className="h-3 w-3 text-red-500 shrink-0" />}
                          {inc.status === "Resolved" && <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />}
                          <span className="truncate" title={inc.title}>{inc.title}</span>
                        </span>
                      </TableCell>
                      <TableCell className="py-2">{severityBadge(inc.severity)}</TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground py-2">{inc.pipeline}</TableCell>
                      <TableCell className="py-2">{statusBadge(inc.status)}</TableCell>
                      <TableCell className="text-xs py-2">
                        <span className="flex items-center gap-1 text-slate-600">
                          <Clock className="h-3 w-3 text-muted-foreground" />
                          {inc.age}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs py-2">
                        <span className="flex items-center gap-1 text-slate-600">
                          <User className="h-3 w-3 text-muted-foreground" />
                          {inc.owner}
                        </span>
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={8} className="p-0">
                          <IncidentDetailSubsection incident={inc} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
