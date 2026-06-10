import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List

from fastapi import APIRouter

from ..config import get_settings
from ..models.overview import (
    ActiveIncident,
    DomainHealth,
    FailedJob,
    HealthDistribution,
    JobStatusPoint,
    OverviewKpis,
)
from ..services import glue_service

try:
    from ..services import jira_service
except ImportError:
    jira_service = None  # type: ignore

log = logging.getLogger(__name__)

router = APIRouter(prefix="/overview", tags=["overview"])


@router.get("/kpis", response_model=OverviewKpis)
def kpis() -> OverviewKpis:
    from ..models.incidents import IncidentSummary
    from ..models.overview import LiveStatus

    jobs = []
    live = LiveStatus(success=0, failed=0, timedOut=0, delayed=0, waitingUpstream=0)
    failed_recent = []
    inc_summary = IncidentSummary(open=0, acknowledged=0, resolved24h=0, p1=0, p2=0, p3=0)

    tasks = {}
    with ThreadPoolExecutor(max_workers=4) as executor:
        tasks[executor.submit(glue_service.list_jobs)] = "jobs"
        tasks[executor.submit(glue_service.live_status)] = "live"
        tasks[executor.submit(glue_service.recent_failed_jobs, limit=100)] = "failed_recent"

        if jira_service:
            tasks[executor.submit(jira_service.summary)] = "inc_summary"

        for future in as_completed(tasks):
            key = tasks[future]
            try:
                result = future.result()
                if key == "jobs":
                    jobs = result
                elif key == "live":
                    live = result
                elif key == "failed_recent":
                    failed_recent = result
                elif key == "inc_summary":
                    inc_summary = result
            except Exception as exc:
                if key == "inc_summary":
                    log.error("Jira summary failed: %s", exc)
                else:
                    log.error("Glue service failed while fetching %s: %s", key, exc)
    
    total = len(jobs)
    failed = live.failed + live.timedOut
    degraded = live.delayed + live.waitingUpstream
    healthy = max(0, total - failed - degraded)
    sla_compliance = round((healthy / total) * 100, 1) if total else 100.0
    return OverviewKpis(
        totalPipelines=total,
        healthy=healthy,
        degraded=degraded,
        failed=failed,
        failedJobs24h=len(failed_recent),
        activeP1=inc_summary.p1,
        activeP2=inc_summary.p2,
        slaBreaches=live.delayed,
        avgMtta=0.0,
        avgMttr=0.0,
        topImpactedDomain="—",
        slaCompliancePercent=sla_compliance,
    )


@router.get("/health-distribution", response_model=HealthDistribution)
def health_distribution() -> HealthDistribution:
    try:
        runs = glue_service.recent_runs()
    except Exception as exc:
        log.error("Glue service recent_runs failed: %s", exc)
        runs = []
    
    by_domain: dict = {}
    for r in runs:
        bucket = by_domain.setdefault(r.domain, {"healthy": 0, "degraded": 0, "failed": 0})
        if r.status == "Success":
            bucket["healthy"] += 1
        elif r.status in ("Failed", "Timed Out"):
            bucket["failed"] += 1
        else:
            bucket["degraded"] += 1
    return HealthDistribution(
        domains=[DomainHealth(name=k, **v) for k, v in by_domain.items()]
    )


@router.get("/job-status-trend", response_model=List[JobStatusPoint])
def job_status_trend() -> List[JobStatusPoint]:
    try:
        return glue_service.hourly_status_trend()
    except Exception as exc:
        log.error("Glue service hourly_status_trend failed: %s", exc)
        return []


@router.get("/failed-jobs", response_model=List[FailedJob])
def failed_jobs() -> List[FailedJob]:
    try:
        return glue_service.recent_failed_jobs()
    except Exception as exc:
        log.error("Glue service recent_failed_jobs failed: %s", exc)
        return []


@router.get("/active-incidents", response_model=List[ActiveIncident])
def active_incidents() -> List[ActiveIncident]:
    if jira_service:
        try:
            records = jira_service.list_records()
        except Exception as exc:
            log.error("Jira list_records failed: %s", exc)
            records = []
    else:
        records = []
    
    return [
        ActiveIncident(
            id=r.id,
            title=r.title,
            severity=r.severity,
            status=r.status,
            pipeline=r.pipeline,
            domain=r.domain,
            createdAt=r.createdAt,
            owner=r.owner,
            acknowledged=r.status not in ("Open", "Investigating"),
            escalationLevel=0,
            age=r.age,
        )
        for r in records
    ]
