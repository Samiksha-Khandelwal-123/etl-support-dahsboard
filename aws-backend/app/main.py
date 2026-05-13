"""FastAPI application factory and entrypoint."""
from __future__ import annotations

import logging

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import __version__
from .config import get_settings
from .logging_config import configure_logging
from .routers import cloudwatch, costs, health, incidents, lambdas, overview, pipelines, rca

log = logging.getLogger(__name__)


def create_app() -> FastAPI:
    configure_logging()
    settings = get_settings()

    app = FastAPI(
        title="ETL Production Support & Cost Insights API",
        version=__version__,
        description="AWS-backed API for the Production Support & Cost Insights Dashboard.",
        docs_url="/docs",
        redoc_url=None,
        openapi_url="/openapi.json",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allow_origins,
        allow_credentials=True,
        allow_methods=["GET", "OPTIONS"],
        allow_headers=["*"],
    )

    # Health endpoints are registered at the root, all others under /api.
    app.include_router(health.router)
    api_routers = [
        overview.router,
        pipelines.router,
        lambdas.router,
        incidents.router,
        costs.router,
        rca.router,
        cloudwatch.router,
    ]
    for r in api_routers:
        app.include_router(r, prefix=settings.api_prefix)

    @app.exception_handler(ClientError)
    async def _client_error(_: Request, exc: ClientError) -> JSONResponse:
        code = exc.response.get("Error", {}).get("Code", "AWSClientError")
        log.warning("AWS ClientError: %s", code)
        status = 502 if code in {"ThrottlingException", "RequestLimitExceeded"} else 500
        return JSONResponse(status_code=status, content={"error": code, "message": str(exc)})

    @app.exception_handler(BotoCoreError)
    async def _botocore_error(_: Request, exc: BotoCoreError) -> JSONResponse:
        log.error("BotoCoreError: %s", exc)
        return JSONResponse(status_code=502, content={"error": "AWSConnectivity", "message": str(exc)})

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        log.exception("Unhandled error")
        return JSONResponse(status_code=500, content={"error": "InternalServerError", "message": str(exc)})

    return app


app = create_app()
