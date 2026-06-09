"""Boto3 client factory with sane production defaults."""
from functools import lru_cache
from typing import Any

import boto3
from botocore.config import Config

from .config import get_settings


def _boto_config() -> Config:
    s = get_settings()
    return Config(
        region_name=s.aws_region,
        retries={"max_attempts": s.boto_max_attempts, "mode": s.boto_retry_mode},
        connect_timeout=s.boto_connect_timeout,
        read_timeout=s.boto_read_timeout,
        user_agent_extra=f"{s.app_name}/{s.app_env}",
    )
def _session() -> boto3.session.Session:
    s = get_settings()
    if s.aws_profile:
        return boto3.session.Session(profile_name=s.aws_profile, region_name=s.aws_region)
    if s.aws_access_key_id and s.aws_secret_access_key:
        return boto3.session.Session(
            aws_access_key_id=s.aws_access_key_id,
            aws_secret_access_key=s.aws_secret_access_key,
            aws_session_token=s.aws_session_token,
            region_name=s.aws_region,
        )
    # Default credential chain (env vars, IAM role, task role, etc.)
    return boto3.session.Session(region_name=s.aws_region)


@lru_cache(maxsize=32)
def client(service_name: str) -> Any:
    """Return a cached boto3 client for the given service."""
    return _session().client(service_name, config=_boto_config())


def reset_clients() -> None:
    """Clear the cached clients (useful in tests)."""
    client.cache_clear()
