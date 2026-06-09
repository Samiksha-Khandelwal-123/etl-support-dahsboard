import logging
from typing import List

from fastapi import APIRouter, HTTPException

from ..models.incidents import (
    IncidentDistributionItem,
    IncidentRecord,
    IncidentSummary,
    MttrTrendPoint,
)
from ..cache import clear_all
from ..config import get_settings

try:
    from ..services import jira_service
except ImportError:
    jira_service = None  # type: ignore

log = logging.getLogger(__name__)

router = APIRouter(prefix="/incidents", tags=["incidents"])


@router.get("/summary", response_model=IncidentSummary)
def summary() -> IncidentSummary:
    if jira_service is None:
        raise HTTPException(status_code=500, detail="Jira service not available")
    try:
        return jira_service.summary()
    except Exception as exc:
        log.error("Jira summary failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Jira error: {str(exc)}")


@router.get("/mttr-trend", response_model=List[MttrTrendPoint])
def mttr_trend() -> List[MttrTrendPoint]:
    log.info("MTTR trend not available, returning empty data")
    return []


@router.get("/distribution", response_model=List[IncidentDistributionItem])
def distribution() -> List[IncidentDistributionItem]:
    if jira_service is None:
        log.warning("Jira service not available, returning empty distribution")
        return []
    try:
        # Get all incident records and calculate distribution by severity
        records = jira_service.list_records(limit=100)
        
        # Count incidents by severity
        severity_counts: dict[str, int] = {}
        for record in records:
            severity = record.severity
            severity_counts[severity] = severity_counts.get(severity, 0) + 1
        
        # Convert to IncidentDistributionItem list, sorted by severity
        severity_order = {"P1": 0, "P2": 1, "P3": 2, "P4": 3}
        distribution = [
            IncidentDistributionItem(severity=severity, count=count)
            for severity, count in sorted(
                severity_counts.items(),
                key=lambda item: severity_order.get(item[0], 999)
            )
        ]
        
        log.info("Incident distribution calculated: %s", distribution)
        return distribution
    except Exception as exc:
        log.error("Error calculating incident distribution: %s", exc)
        raise HTTPException(status_code=500, detail=f"Error: {str(exc)}")


@router.get("/list", response_model=List[IncidentRecord])
def listing() -> List[IncidentRecord]:
    if jira_service is None:
        raise HTTPException(status_code=500, detail="Jira service not available")
    try:
        return jira_service.list_records()
    except Exception as exc:
        log.error("Jira list_records failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Jira error: {str(exc)}")


@router.post("/refresh-cache")
def refresh_cache() -> dict:
    """Clear all caches to force fetch fresh data from Jira on next request."""
    try:
        clear_all()
        log.info("All caches cleared, fresh data will be fetched on next request")
        return {"status": "success", "message": "Cache cleared successfully"}
    except Exception as exc:
        log.error("Error clearing cache: %s", exc)
        raise HTTPException(status_code=500, detail=f"Error clearing cache: {str(exc)}")


@router.get("/diagnostics")
def diagnostics() -> dict:
    """Get diagnostic information about Jira configuration and connection status."""
    try:
        settings = get_settings()
        diagnostics_info = {
            "jira_url": settings.jira_url,
            "jira_username": settings.jira_username,
            "jira_project_key": settings.jira_project_key,
            "jira_issue_type": settings.jira_issue_type,
            "use_jira_incidents": settings.use_jira_incidents,
            "service_available": jira_service is not None,
            "connection_status": "unknown"
        }
        
        # Try to verify connection
        if jira_service is None:
            diagnostics_info["connection_status"] = "service_not_available"
            diagnostics_info["error"] = "Jira service not imported"
        else:
            try:
                # Try to list issues to verify connection
                issues = jira_service.list_issues(days=1)
                diagnostics_info["connection_status"] = "connected"
                diagnostics_info["total_issues"] = len(issues)
                log.info("Diagnostic check passed: %d issues found", len(issues))
            except Exception as conn_exc:
                diagnostics_info["connection_status"] = "error"
                diagnostics_info["error"] = str(conn_exc)
                log.error("Diagnostic check failed: %s", conn_exc)
        
        return diagnostics_info
    except Exception as exc:
        log.error("Error getting diagnostics: %s", exc)
        raise HTTPException(status_code=500, detail=f"Error: {str(exc)}")


@router.get("/available-issue-types")
def available_issue_types() -> dict:
    """Get list of available issue types in the configured Jira project."""
    try:
        if jira_service is None:
            raise HTTPException(status_code=500, detail="Jira service not available")
        
        # Get all issues to determine available issue types
        issues = jira_service.list_issues(days=30)
        
        issue_types = set()
        for issue in issues:
            if hasattr(issue, 'fields') and hasattr(issue.fields, 'issuetype') and issue.fields.issuetype:
                issue_types.add(issue.fields.issuetype.name)
        
        settings = get_settings()
        return {
            "current_issue_type": settings.jira_issue_type,
            "available_issue_types": sorted(list(issue_types)),
            "total_issues": len(issues),
            "message": f"To use a different issue type, update JIRA_ISSUE_TYPE in your .env file to one of the available types above."
        }
    except Exception as exc:
        log.error("Error getting available issue types: %s", exc)
        raise HTTPException(status_code=500, detail=f"Error: {str(exc)}")
