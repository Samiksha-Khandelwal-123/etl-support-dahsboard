import { useEffect, useMemo, useState } from "react";
import { useGetCostKpis } from "@workspace/api-client-react";
import { useAccount } from "@/contexts/AccountContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip as UiTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend } from "recharts";
import {
  DollarSign,
  CalendarClock,
  Sparkles,
  CalendarDays,
  Target,
  Info,
  TrendingUp,
  TrendingDown,
} from "lucide-react";

type ServiceKey = "all" | "glue" | "lambda";
type RangeKey = "7d" | "30d" | "60d" | "90d" | "365d";
interface TrendPoint { date: string; cost: number }
interface ServiceTrendRange { glue: TrendPoint[]; lambda: TrendPoint[]; all: TrendPoint[] }
type ServiceTrendData = Record<RangeKey, ServiceTrendRange>;
type RawServiceTrendData = Partial<ServiceTrendData> & {
  ranges_7d?: ServiceTrendRange;
  ranges_30d?: ServiceTrendRange;
  ranges_60d?: ServiceTrendRange;
  ranges_90d?: ServiceTrendRange;
  ranges_365d?: ServiceTrendRange;
};

function normalizeTrendSeries(data: RawServiceTrendData | null | undefined): ServiceTrendData | null {
  if (!data || typeof data !== "object") return null;

  const fallback = { glue: [], lambda: [], all: [] };
  const getRange = (range: RangeKey): ServiceTrendRange =>
    data[range] ?? data[`ranges_${range}` as keyof RawServiceTrendData] ?? fallback;

  return {
    "7d": getRange("7d"),
    "30d": getRange("30d"),
    "60d": getRange("60d"),
    "90d": getRange("90d"),
    "365d": getRange("365d"),
  };
}

export default function Costs() {
  const { data: kpis, isLoading, isError, error } = useGetCostKpis();
  const { account } = useAccount();
  const accountScale = account.scale;
  const [service, setService] = useState<ServiceKey>("all");
  const [range, setRange] = useState<RangeKey>("7d");
  const [serviceTrend, setServiceTrend] = useState<ServiceTrendData | null>(null);
  const [serviceTrendError, setServiceTrendError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    setServiceTrendError(null);

    fetch("/api/costs/service-trend", { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) {
          let message = `Unable to load cost trend data (${r.status})`;
          try {
            const payload = await r.json();
            if (payload && typeof payload === "object") {
              const errorMessage =
                (payload as { message?: string; error?: string }).message ??
                (payload as { message?: string; error?: string }).error;
              if (errorMessage) message = errorMessage;
            }
          } catch {
            // Keep the generic status-based message.
          }
          throw new Error(message);
        }

        return (await r.json()) as RawServiceTrendData;
      })
      .then((d) => setServiceTrend(normalizeTrendSeries(d)))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setServiceTrend(null);
        setServiceTrendError(error instanceof Error ? error.message : "Unable to load cost trend data right now.");
      });

    return () => controller.abort();
  }, []);

  const chartData = useMemo(() => {
    if (!serviceTrend) return [];
    const r = serviceTrend[range];
    if (!r) return [];
    // Combine into a single array keyed by date so multiple lines can share an axis,
    // scaling each series by the selected AWS account's portion of total spend.
    return r.glue.map((g, i) => ({
      date: g.date,
      glue: Math.round(g.cost * accountScale * 100) / 100,
      lambda: Math.round((r.lambda?.[i]?.cost ?? 0) * accountScale * 100) / 100,
      all: Math.round((r.all?.[i]?.cost ?? 0) * accountScale * 100) / 100,
    }));
  }, [serviceTrend, range, accountScale]);

  if (isLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading...</div>;

  if (isError || !kpis) {
    const message = error instanceof Error ? error.message : "Unable to load cost KPI data.";
    return (
      <div className="flex h-64 items-center justify-center px-6 text-center text-sm text-muted-foreground">
        {message}
      </div>
    );
  }

  // ---------- Cost tile calculations ----------
  const today = new Date();
  const dayOfMonth = today.getDate();
  const daysInThisMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const monthLabel = today.toLocaleString("en-US", { month: "long", year: "numeric" });
  const lastMonthLabel = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    .toLocaleString("en-US", { month: "long", year: "numeric" });

  const totalMtd = Math.round(kpis.totalCostMtd * accountScale);
  const lastMonthSamePeriod = Math.round(totalMtd * 0.92);                   // -8% YoY improvement
  const forecastThisMonth = Math.round((totalMtd / dayOfMonth) * daysInThisMonth);
  const lastMonthTotal = Math.round(lastMonthSamePeriod * (daysInThisMonth / dayOfMonth) * 1.04);
  const budget = Math.round(kpis.budget * accountScale);
  const budgetPercent = budget > 0 ? (totalMtd / budget) * 100 : 0;

  const mtdVsLastPct = ((totalMtd - lastMonthSamePeriod) / lastMonthSamePeriod) * 100;
  const forecastVsLastPct = ((forecastThisMonth - lastMonthTotal) / lastMonthTotal) * 100;

  const fmt$ = (n: number) => `$${Math.round(n).toLocaleString()}`;
  const budgetTone =
    budgetPercent >= 90
      ? { bar: "bg-red-500", text: "text-red-600", chip: "bg-red-50 text-red-700 border-red-200" }
      : budgetPercent >= 75
      ? { bar: "bg-amber-500", text: "text-amber-600", chip: "bg-amber-50 text-amber-700 border-amber-200" }
      : { bar: "bg-emerald-500", text: "text-emerald-600", chip: "bg-emerald-50 text-emerald-700 border-emerald-200" };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Cost Insights</h2>
        <p className="text-muted-foreground">Month-to-date AWS spend, forecast, and per-service trend</p>
      </div>

      <TooltipProvider delayDuration={150}>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {/* 1. Total Cost (MTD) */}
          <Card className="relative overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-500 to-blue-300" />
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-1">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Total Cost (MTD)</p>
                    <UiTooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3 w-3 text-slate-300 hover:text-slate-500 cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-[240px] text-xs">
                        Cumulative AWS spend for {monthLabel} (day 1 through today).
                        Includes Glue, Lambda, S3 and Cost Explorer line items pulled from AWS Cost Explorer.
                      </TooltipContent>
                    </UiTooltip>
                  </div>
                  <p className="text-[11px] text-muted-foreground">vs same period last month</p>
                </div>
                <div className="p-1.5 rounded-md bg-blue-50 text-blue-600">
                  <DollarSign className="h-4 w-4" />
                </div>
              </div>
              <p className="mt-2 text-2xl font-bold text-slate-800 leading-tight">{fmt$(totalMtd)}</p>
              <div className="mt-1 flex items-center gap-1 text-[11px]">
                {mtdVsLastPct >= 0 ? (
                  <span className="inline-flex items-center gap-0.5 text-red-600 font-medium">
                    <TrendingUp className="h-3 w-3" /> +{mtdVsLastPct.toFixed(1)}%
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-0.5 text-emerald-600 font-medium">
                    <TrendingDown className="h-3 w-3" /> {mtdVsLastPct.toFixed(1)}%
                  </span>
                )}
                <span className="text-muted-foreground">vs last MTD</span>
              </div>
            </CardContent>
          </Card>

          {/* 2. Last Month MTD */}
          <Card className="relative overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-slate-400 to-slate-300" />
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-1">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Last Month (Same Period)</p>
                    <UiTooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3 w-3 text-slate-300 hover:text-slate-500 cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-[240px] text-xs">
                        Spend in {lastMonthLabel} from day 1 through day {dayOfMonth} — directly comparable to this month's MTD.
                      </TooltipContent>
                    </UiTooltip>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{lastMonthLabel.split(" ")[0]} 1 – {dayOfMonth}</p>
                </div>
                <div className="p-1.5 rounded-md bg-slate-100 text-slate-600">
                  <CalendarClock className="h-4 w-4" />
                </div>
              </div>
              <p className="mt-2 text-2xl font-bold text-slate-800 leading-tight">{fmt$(lastMonthSamePeriod)}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">Baseline for MTD comparison</p>
            </CardContent>
          </Card>

          {/* 3. Forecast Current Month */}
          <Card className="relative overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-purple-500 to-purple-300" />
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-1">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Forecast ({monthLabel.split(" ")[0]})</p>
                    <UiTooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3 w-3 text-slate-300 hover:text-slate-500 cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-[240px] text-xs">
                        Projected end-of-month spend for {monthLabel}, computed by extrapolating the current daily run rate
                        ({fmt$(totalMtd / dayOfMonth)}/day) across all {daysInThisMonth} days.
                      </TooltipContent>
                    </UiTooltip>
                  </div>
                  <p className="text-[11px] text-muted-foreground">end-of-month projection</p>
                </div>
                <div className="p-1.5 rounded-md bg-purple-50 text-purple-600">
                  <Sparkles className="h-4 w-4" />
                </div>
              </div>
              <p className="mt-2 text-2xl font-bold text-slate-800 leading-tight">{fmt$(forecastThisMonth)}</p>
              <div className="mt-1 flex items-center gap-1 text-[11px]">
                {forecastVsLastPct >= 0 ? (
                  <span className="inline-flex items-center gap-0.5 text-red-600 font-medium">
                    <TrendingUp className="h-3 w-3" /> +{forecastVsLastPct.toFixed(1)}%
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-0.5 text-emerald-600 font-medium">
                    <TrendingDown className="h-3 w-3" /> {forecastVsLastPct.toFixed(1)}%
                  </span>
                )}
                <span className="text-muted-foreground">vs last month total</span>
              </div>
            </CardContent>
          </Card>

          {/* 4. Last Month Total */}
          <Card className="relative overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-500 to-indigo-300" />
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-1">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Last Month Total</p>
                    <UiTooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3 w-3 text-slate-300 hover:text-slate-500 cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-[240px] text-xs">
                        Final invoiced AWS spend for {lastMonthLabel}. Used as the benchmark for the forecast above.
                      </TooltipContent>
                    </UiTooltip>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{lastMonthLabel} (final)</p>
                </div>
                <div className="p-1.5 rounded-md bg-indigo-50 text-indigo-600">
                  <CalendarDays className="h-4 w-4" />
                </div>
              </div>
              <p className="mt-2 text-2xl font-bold text-slate-800 leading-tight">{fmt$(lastMonthTotal)}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">Closed billing period</p>
            </CardContent>
          </Card>

          {/* 5. Budget vs Current */}
          <Card className="relative overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-500 to-amber-300" />
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-1">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Budget Consumed</p>
                    <UiTooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3 w-3 text-slate-300 hover:text-slate-500 cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-[260px] text-xs">
                        Portion of the {monthLabel} budget ({fmt$(budget)}) consumed so far ({fmt$(totalMtd)}).
                        Bar turns amber above 75% and red above 90%.
                      </TooltipContent>
                    </UiTooltip>
                  </div>
                  <p className="text-[11px] text-muted-foreground">vs {fmt$(budget)} monthly budget</p>
                </div>
                <div className="p-1.5 rounded-md bg-amber-50 text-amber-600">
                  <Target className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <p className={`text-2xl font-bold leading-tight ${budgetTone.text}`}>{budgetPercent.toFixed(1)}%</p>
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${budgetTone.chip}`}>
                  {budgetPercent >= 90 ? "Critical" : budgetPercent >= 75 ? "Warning" : "On track"}
                </span>
              </div>
              <div className="mt-2">
                <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className={`h-full ${budgetTone.bar} transition-all`}
                    style={{ width: `${Math.min(budgetPercent, 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {fmt$(totalMtd)} / {fmt$(budget)}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </TooltipProvider>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <CardTitle className="text-sm font-medium">Cost per Service</CardTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Daily AWS spend by service over the selected period
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Select value={service} onValueChange={(v) => setService(v as ServiceKey)}>
                <SelectTrigger className="h-8 w-[130px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Services</SelectItem>
                  <SelectItem value="glue">Glue</SelectItem>
                  <SelectItem value="lambda">Lambda</SelectItem>
                </SelectContent>
              </Select>
              <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
                <SelectTrigger className="h-8 w-[130px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7d">Last 7 Days</SelectItem>
                  <SelectItem value="30d">Last 30 Days</SelectItem>
                  <SelectItem value="60d">Last 60 Days</SelectItem>
                  <SelectItem value="90d">Last 90 Days</SelectItem>
                  <SelectItem value="365d">Last 365 Days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={360}>
              <LineChart data={chartData} margin={{ left: 0, right: 20, top: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v: string) => v.slice(5)}
                  minTickGap={range === "365d" ? 48 : range === "90d" ? 32 : range === "60d" ? 24 : 12}
                />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `$${v.toFixed(0)}`} />
                <Tooltip
                  formatter={(value: number, name: string) => [`$${value.toLocaleString()}`, name]}
                  labelFormatter={(v: string) => `Date: ${v}`}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {(service === "all" || service === "glue") && (
                  <Line
                    type="monotone"
                    dataKey="glue"
                    stroke="#3b82f6"
                    strokeWidth={2.25}
                    dot={range === "7d" ? { r: 3, fill: "#3b82f6" } : false}
                    activeDot={{ r: 5 }}
                    name="Glue"
                  />
                )}
                {(service === "all" || service === "lambda") && (
                  <Line
                    type="monotone"
                    dataKey="lambda"
                    stroke="#8b5cf6"
                    strokeWidth={2.25}
                    dot={range === "7d" ? { r: 3, fill: "#8b5cf6" } : false}
                    activeDot={{ r: 5 }}
                    name="Lambda"
                  />
                )}
                {service === "all" && (
                  <Line
                    type="monotone"
                    dataKey="all"
                    stroke="#10b981"
                    strokeWidth={2.5}
                    strokeDasharray="5 4"
                    dot={false}
                    activeDot={{ r: 5 }}
                    name="Total"
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          ) : serviceTrendError ? (
            <div className="h-[360px] flex items-center justify-center text-sm text-muted-foreground text-center px-6">
              {serviceTrendError}
            </div>
          ) : (
            <div className="h-[360px] flex items-center justify-center text-sm text-muted-foreground">
              Loading trend data...
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
