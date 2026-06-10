from typing import Dict, List

from pydantic import BaseModel


class CostKpis(BaseModel):
    totalCostMtd: float
    avgCostPerRun: float
    costOfFailedRuns: float
    budget: float


class CostByPipeline(BaseModel):
    name: str
    cost: float


class CostBreakdown(BaseModel):
    byPipeline: List[CostByPipeline]


class CostTrendPoint(BaseModel):
    date: str
    cost: float


class CostPerformance(BaseModel):
    costVsPipeline: List[CostTrendPoint]
    costRanges: Dict[str, List[CostTrendPoint]]


class ServiceTrendSeries(BaseModel):
    glue: List[CostTrendPoint]
    lambda_: List[CostTrendPoint]  # Using lambda_ to avoid keyword conflict
    all: List[CostTrendPoint]

    class Config:
        fields = {"lambda_": {"alias": "lambda"}}
        populate_by_name = True


class ServiceTrend(BaseModel):
    ranges_7d: ServiceTrendSeries
    ranges_30d: ServiceTrendSeries
    ranges_60d: ServiceTrendSeries
    ranges_90d: ServiceTrendSeries
    ranges_365d: ServiceTrendSeries

    class Config:
        fields = {
            "ranges_7d": {"alias": "7d"},
            "ranges_30d": {"alias": "30d"},
            "ranges_60d": {"alias": "60d"},
            "ranges_90d": {"alias": "90d"},
            "ranges_365d": {"alias": "365d"},
        }
        populate_by_name = True
