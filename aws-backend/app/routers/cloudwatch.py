"""CloudWatch logs API routes."""
from fastapi import APIRouter, Query

from ..services import cloudwatch_service

router = APIRouter(prefix="/logs", tags=["logs"])


@router.get("/job/{job_id}")
def get_job_logs(job_id: str, limit: int = Query(100, ge=1, le=1000)):
    """
    Fetch CloudWatch logs for a Glue job run.
    
    Args:
        job_id: The Glue job run ID
        limit: Maximum number of log events to return (1-1000, default 100)
    """
    return cloudwatch_service.get_job_logs(job_id, limit=limit)


@router.get("/lambda/{function_name}")
def get_lambda_logs(function_name: str, limit: int = Query(100, ge=1, le=1000)):
    """
    Fetch CloudWatch logs for a Lambda function.
    
    Args:
        function_name: The Lambda function name
        limit: Maximum number of log events to return (1-1000, default 100)
    """
    return cloudwatch_service.get_lambda_logs(function_name, limit=limit)
