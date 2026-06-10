"""AWS Cost Explorer-backed cost data."""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import List

from botocore.exceptions import BotoCoreError, ClientError

from ..aws import client
from ..cache import cached
from ..config import get_settings
from ..models.costs import (
    CostBreakdown,
    CostByPipeline,
    CostKpis,
    CostPerformance,
    CostTrendPoint,
    ServiceTrend,
    ServiceTrendSeries,
)

log = logging.getLogger(__name__)


def _ce_client():
    return client("ce")


def _today() -> date:
    return datetime.utcnow().date()


def _month_start() -> date:
    return _today().replace(day=1)


def _fetch_grouped(start: date, end: date, group_key: str, granularity: str = "DAILY"):
    ce = _ce_client()
    try:
        resp = ce.get_cost_and_usage(
            TimePeriod={"Start": start.isoformat(), "End": end.isoformat()},
            Granularity=granularity,
            Metrics=["UnblendedCost"],
            GroupBy=[{"Type": "TAG", "Key": group_key}],
        )
    except (BotoCoreError, ClientError) as exc:
        log.error("CostExplorer get_cost_and_usage failed: %s", exc)
        raise
    return resp


@cached("long")
def kpis() -> CostKpis:
    settings = get_settings()
    today = _today()
    start = _month_start()
    end = today + timedelta(days=1)
    ce = _ce_client()

    try:
        total = ce.get_cost_and_usage(
            TimePeriod={"Start": start.isoformat(), "End": end.isoformat()},
            Granularity="MONTHLY",
            Metrics=["UnblendedCost"],
        )
        budgets = client("budgets").describe_budgets(
            AccountId=client("sts").get_caller_identity()["Account"],
            MaxResults=10,
        )
    except (BotoCoreError, ClientError) as exc:
        log.error("kpis aggregation failed: %s", exc)
        raise

    total_cost = float(
        total["ResultsByTime"][0]["Total"]["UnblendedCost"]["Amount"] or 0.0
    )
    budget_amount = 0.0
    for b in budgets.get("Budgets", []):
        if settings.cost_explorer_tag_key in (b.get("Name", "")):
            budget_amount = float(b.get("BudgetLimit", {}).get("Amount", 0.0))
            break
    if budget_amount == 0.0 and budgets.get("Budgets"):
        budget_amount = float(
            budgets["Budgets"][0].get("BudgetLimit", {}).get("Amount", 0.0)
        )

    failed_cost = total_cost * 0.08  # heuristic; refine with job-state correlation
    runs = max(1, int(total_cost / 5.0))
    avg = round(total_cost / runs, 2) if runs else 0.0
    return CostKpis(
        totalCostMtd=round(total_cost, 2),
        avgCostPerRun=avg,
        costOfFailedRuns=round(failed_cost, 2),
        budget=round(budget_amount or total_cost * 1.2, 2),
    )


@cached("long")
def breakdown(top_n: int = 10) -> CostBreakdown:
    settings = get_settings()
    start = _month_start()
    end = _today() + timedelta(days=1)
    resp = _fetch_grouped(start, end, settings.cost_explorer_tag_key, granularity="MONTHLY")
    pipeline_costs: dict = {}
    for window in resp.get("ResultsByTime", []):
        for grp in window.get("Groups", []):
            key = (grp.get("Keys") or ["unknown"])[0]
            name = key.split("$", 1)[-1] or "unknown"
            amount = float(grp["Metrics"]["UnblendedCost"]["Amount"] or 0.0)
            pipeline_costs[name] = pipeline_costs.get(name, 0.0) + amount
    items = sorted(
        ({"name": k, "cost": round(v, 2)} for k, v in pipeline_costs.items()),
        key=lambda x: x["cost"],
        reverse=True,
    )[:top_n]
    return CostBreakdown(byPipeline=[CostByPipeline(**i) for i in items])


def _trend(days: int) -> List[CostTrendPoint]:
    ce = _ce_client()
    end = _today() + timedelta(days=1)
    start = end - timedelta(days=days)
    try:
        resp = ce.get_cost_and_usage(
            TimePeriod={"Start": start.isoformat(), "End": end.isoformat()},
            Granularity="DAILY",
            Metrics=["UnblendedCost"],
        )
    except (BotoCoreError, ClientError) as exc:
        log.error("trend(%d) failed: %s", days, exc)
        raise
    out: List[CostTrendPoint] = []
    for r in resp.get("ResultsByTime", []):
        out.append(
            CostTrendPoint(
                date=r["TimePeriod"]["Start"],
                cost=round(float(r["Total"]["UnblendedCost"]["Amount"] or 0.0), 2),
            )
        )
    return out


@cached("long")
def performance() -> CostPerformance:
    weekly = _trend(7)
    monthly = _trend(30)
    today_pt = weekly[-1:] if weekly else []
    return CostPerformance(
        costVsPipeline=weekly,
        costRanges={"today": today_pt, "7d": weekly, "30d": monthly},
    )


def _trend_by_service(days: int, service: str) -> List[CostTrendPoint]:
    """Fetch cost trend for a specific AWS service."""
    ce = _ce_client()
    end = _today() + timedelta(days=1)
    start = end - timedelta(days=days)
    try:
        resp = ce.get_cost_and_usage(
            TimePeriod={"Start": start.isoformat(), "End": end.isoformat()},
            Granularity="DAILY",
            Metrics=["UnblendedCost"],
            Filter={
                "Dimensions": {
                    "Key": "SERVICE",
                    "Values": [service],
                }
            },
        )
    except (BotoCoreError, ClientError) as exc:
        log.error("trend_by_service(%d, %s) failed: %s", days, service, exc)
        return []
    out: List[CostTrendPoint] = []
    for r in resp.get("ResultsByTime", []):
        out.append(
            CostTrendPoint(
                date=r["TimePeriod"]["Start"],
                cost=round(float(r["Total"]["UnblendedCost"]["Amount"] or 0.0), 2),
            )
        )
    return out


@cached("long")
def service_trend() -> ServiceTrend:
    """Get cost trends for Glue and Lambda services over 7d, 30d, 60d, 90d, and 365d windows."""
    def build_range(days: int) -> ServiceTrendSeries:
        glue = _trend_by_service(days, "AWS Glue")
        lambda_ = _trend_by_service(days, "AWS Lambda")
        # Combine both services
        combined = []
        for i, g in enumerate(glue):
            if i < len(lambda_):
                combined.append(
                    CostTrendPoint(
                        date=g.date,
                        cost=round(g.cost + lambda_[i].cost, 2),
                    )
                )
        return ServiceTrendSeries(glue=glue, lambda_=lambda_, all=combined)

    return ServiceTrend(
        ranges_7d=build_range(7),
        ranges_30d=build_range(30),
        ranges_60d=build_range(60),
        ranges_90d=build_range(90),
        ranges_365d=build_range(365),
    )
