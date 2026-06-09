"""Application configuration loaded from environment variables."""
from functools import lru_cache
from typing import List, Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from dotenv import load_dotenv
load_dotenv()


class Settings(BaseSettings):
    """Runtime settings. All values configurable via environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ---- App ----
    app_name: str = "etl-dashboard-api"
    app_env: str = Field(default="production", description="dev | staging | production")
    log_level: str = "INFO"
    api_prefix: str = "/api"
    cors_allow_origins: List[str] = Field(default_factory=lambda: ["*"])

    # ---- AWS ----
    aws_region: str = Field(default="us-east-1", description="Primary AWS region")
    aws_profile: Optional[str] = None
    # Optional explicit creds; otherwise default credential chain is used.
    aws_access_key_id: Optional[str] = None
    aws_secret_access_key: Optional[str] = None
    aws_session_token: Optional[str] = None

    # boto3 retry / timeouts
    boto_max_attempts: int = 6
    boto_retry_mode: str = "standard"  # legacy | standard | adaptive
    boto_connect_timeout: int = 5
    boto_read_timeout: int = 30

    # ---- Caching ----
    cache_ttl_short: int = 30      # seconds (live status, runs)
    cache_ttl_medium: int = 300    # seconds (KPIs, distributions)
    cache_ttl_long: int = 1800     # seconds (cost explorer, history)
    cache_maxsize: int = 1024

    # ---- Domain config ----
    glue_job_name_filter: Optional[str] = Field(
        default=None, description="Optional substring to filter Glue jobs by name."
    )
    lambda_function_tag_key: str = Field(
        default="Project",
        description="Tag key used to filter Lambda functions belonging to the ETL platform.",
    )
    lambda_function_tag_value: Optional[str] = Field(
        default=None,
        description="If set, only functions with this tag value are included.",
    )
    cost_explorer_tag_key: str = Field(
        default="CostCenter",
        description="Tag key used to group cost explorer queries.",
    )
    sla_breach_minutes: int = 60

    # ---- Jira Integration ----
    jira_url: Optional[str] = None
    jira_username: Optional[str] = None
    jira_api_token: Optional[str] = None
    jira_project_key: str = Field(default="SCRUM", description="Jira project key for incident board")
    use_jira_incidents: bool = Field(default=True, description="Use Jira as incident source instead of SSM for incidents and RCA")
    jira_issue_type: Optional[str] = Field(default=None, description="Optional Jira issue type to track as incidents; leave unset to fetch all project tickets")
    jira_status_mapping: dict = Field(
        default_factory=lambda: {"To Do": "Open", "In Progress": "Investigating", "In Review": "Mitigating", "Done": "Resolved"},
        description="Map Jira status to incident status"
    )
    jira_priority_mapping: dict = Field(
        default_factory=lambda: {"Highest": "P1", "High": "P2", "Medium": "P3", "Low": "P4"},
        description="Map Jira priority to severity"
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached settings instance."""
    return Settings()
