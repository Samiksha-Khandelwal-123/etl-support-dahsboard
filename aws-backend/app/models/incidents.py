from typing import List

from pydantic import BaseModel


class IncidentSummary(BaseModel):
    openByP1: int
    openByP2: int
    openByP3: int
    openByP4: int
    aging0to1h: int
    aging1to4h: int
    aging4to12h: int
    aging12hPlus: int
    acknowledged: int
    unacknowledged: int


class MttrTrendPoint(BaseModel):
    date: str
    mtta: float
    mttr: float
    incidents: int


class IncidentDistributionItem(BaseModel):
    severity: str
    count: int


class IncidentRecord(BaseModel):
    id: str
    title: str
    severity: str
    status: str
    pipeline: str
    domain: str
    createdAt: str
    owner: str
    age: str


class IncidentList(BaseModel):
    items: List[IncidentRecord]
