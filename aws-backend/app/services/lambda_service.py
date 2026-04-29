"""AWS  Lambda-backed metrics via Lambda + CloudWatch."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from botocore.exceptions import BotoCoreError, ClientError

from ..aws import client
from ..cache import cached
from ..config import get_settings
from ..models.lambdas import LambdaInvocation, LambdaKpis

log = logging.getLogger(__name__)

# AWS Lambda pricing constants (us-east-1 x86, on-demand).
_PRICE_PER_REQUEST = 0.0000002          # USD per invocation
_PRICE_PER_GB_SECOND = 0.0000166667     # USD per GB-second


def _matches_tag(tags: dict) -> bool:
    s = get_settings()
    if not s.lambda_function_tag_value:
        return True
    return tags.get(s.lambda_function_tag_key) == s.lambda_function_tag_value


@cached("medium")
def list_functions() -> List[dict]:
    lam = client("lambda")
    fns: List[dict] = []
    try:
        paginator = lam.get_paginator("list_functions")
        for page in paginator.paginate():
            for fn in page.get("Functions", []):
                try:
                    arn = fn["FunctionArn"]
                    tags = lam.list_tags(Resource=arn).get("Tags", {}) or {}
                except (BotoCoreError, ClientError):
                    tags = {}
                if not _matches_tag(tags):
                    continue
                fn["_tags"] = tags
                fns.append(fn)
    except (BotoCoreError, ClientError) as exc:
        log.error("Lambda list_functions failed: %s", exc)
        raise
    return fns


def _metric_sum(name: str, function_name: str, period_minutes: int = 1440) -> float:
    cw = client("cloudwatch")
    end = datetime.now(timezone.utc)
    start = end - timedelta(minutes=period_minutes)
    try:
        resp = cw.get_metric_statistics(
            Namespace="AWS/Lambda",
            MetricName=name,
            Dimensions=[{"Name": "FunctionName", "Value": function_name}],
            StartTime=start,
            EndTime=end,
            Period=period_minutes * 60,
            Statistics=["Sum"],
        )
    except (BotoCoreError, ClientError) as exc:
        log.warning("CW %s for %s failed: %s", name, function_name, exc)
        return 0.0
    return sum(d.get("Sum", 0.0) for d in resp.get("Datapoints", []))


def _metric_avg(name: str, function_name: str, period_minutes: int = 1440) -> float:
    cw = client("cloudwatch")
    end = datetime.now(timezone.utc)
    start = end - timedelta(minutes=period_minutes)
    try:
        resp = cw.get_metric_statistics(
            Namespace="AWS/Lambda",
            MetricName=name,
            Dimensions=[{"Name": "FunctionName", "Value": function_name}],
            StartTime=start,
            EndTime=end,
            Period=period_minutes * 60,
            Statistics=["Average"],
        )
    except (BotoCoreError, ClientError) as exc:
        log.warning("CW %s for %s failed: %s", name, function_name, exc)
        return 0.0
    pts = resp.get("Datapoints", [])
    return sum(d.get("Average", 0.0) for d in pts) / len(pts) if pts else 0.0


def _cost_per_invocation(memory_mb: int, avg_duration_ms: float) -> float:
    gb_seconds = (memory_mb / 1024.0) * (avg_duration_ms / 1000.0)
    return round(_PRICE_PER_REQUEST + gb_seconds * _PRICE_PER_GB_SECOND, 6)


@cached("medium")
def kpis() -> LambdaKpis:
    fns = list_functions()
    total = len(fns)
    healthy = 0
    with_errors = 0
    throttled_total = 0
    invocations_total = 0
    durations: List[float] = []
    cold_total = 0.0
    init_total = 0.0

    for fn in fns:
        name = fn["FunctionName"]
        invocations = _metric_sum("Invocations", name)
        errors = _metric_sum("Errors", name)
        throttles = _metric_sum("Throttles", name)
        avg_dur = _metric_avg("Duration", name)
        init_dur = _metric_sum("InitDuration", name)

        invocations_total += int(invocations)
        throttled_total += int(throttles)
        durations.append(avg_dur)
        cold_total += init_dur
        init_total += invocations
        if errors > 0:
            with_errors += 1
        else:
            healthy += 1

    avg_dur_ms = round(sum(durations) / len(durations), 2) if durations else 0.0
    cold_pct = round((cold_total / init_total) * 100, 2) if init_total else 0.0
    return LambdaKpis(
        totalFunctions=total,
        healthy=healthy,
        withErrors=with_errors,
        throttled=throttled_total,
        avgDurationMs=avg_dur_ms,
        coldStartsPercent=cold_pct,
        totalInvocations24h=invocations_total,
    )


def _fmt_duration(ms: float) -> str:
    if ms <= 0:
        return "—"
    if ms < 1000:
        return f"{int(ms)}ms"
    return f"{ms / 1000.0:.1f}s"


def _status(errors: float, throttles: float, invocations: float) -> str:
    if errors > 0:
        return "Failed"
    if throttles > 0:
        return "Timed Out"
    if invocations > 0:
        return "Success"
    return "Waiting"


def _logs_latest_invocation(function_name: str) -> Optional[dict]:
    """Find the latest invocation start/end timestamps from CloudWatch Logs."""
    logs = client("logs")
    try:
        streams = logs.describe_log_streams(
            logGroupName=f"/aws/lambda/{function_name}",
            orderBy="LastEventTime",
            descending=True,
            limit=1,
        ).get("logStreams", [])
        if not streams:
            return None
        events = logs.get_log_events(
            logGroupName=f"/aws/lambda/{function_name}",
            logStreamName=streams[0]["logStreamName"],
            limit=20,
            startFromHead=False,
        ).get("events", [])
    except (BotoCoreError, ClientError):
        return None

    start_ts = events[0]["timestamp"] if events else None
    end_ts = events[-1]["timestamp"] if events else None
    return {
        "start": datetime.fromtimestamp(start_ts / 1000, tz=timezone.utc) if start_ts else None,
        "end": datetime.fromtimestamp(end_ts / 1000, tz=timezone.utc) if end_ts else None,
    }


@cached("short")
def recent_invocations(limit: int = 12) -> List[LambdaInvocation]:
    out: List[LambdaInvocation] = []
    for fn in list_functions()[:limit]:
        name = fn["FunctionName"]
        invocations = _metric_sum("Invocations", name, period_minutes=60)
        errors = _metric_sum("Errors", name, period_minutes=60)
        throttles = _metric_sum("Throttles", name, period_minutes=60)
        avg_dur = _metric_avg("Duration", name, period_minutes=60)
        memory = int(fn.get("MemorySize", 128))
        latest = _logs_latest_invocation(name) or {}
        start = latest.get("start")
        end = latest.get("end")
        out.append(
            LambdaInvocation(
                id=f"INV-{abs(hash(name)) % 100000:05d}",
                functionName=name,
                status=_status(errors, throttles, invocations),
                startTime=start.isoformat() if start else "",
                endTime=end.isoformat() if end else "",
                duration=_fmt_duration(avg_dur),
                costPerRun=_cost_per_invocation(memory, avg_dur),
            )
        )
    return out
