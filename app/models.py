"""Pydantic models for request validation and response shaping."""
from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Workspace
# ---------------------------------------------------------------------------

class WorkspaceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    emoji: str = Field(default="📁")


class WorkspaceUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    emoji: str = Field(default="📁")


class WorkspaceOut(BaseModel):
    id: int
    name: str
    emoji: str
    created_at: datetime


# ---------------------------------------------------------------------------
# Category
# ---------------------------------------------------------------------------

class CategoryCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    color: str = Field(default="#0053e2")
    description: Optional[str] = None


class CategoryOut(BaseModel):
    id: int
    name: str
    color: str
    description: Optional[str]
    created_at: datetime


# ---------------------------------------------------------------------------
# Attribute Definitions
# ---------------------------------------------------------------------------

class AttrDefinitionCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    field_type: str = Field(default="text")  # text | number | date | select
    options: Optional[str] = None  # comma-separated for select type


class AttrDefinitionOut(BaseModel):
    id: int
    name: str
    field_type: str
    options: Optional[str]


# ---------------------------------------------------------------------------
# Note Attribute Value
# ---------------------------------------------------------------------------

class NoteAttributeIn(BaseModel):
    key: str
    value: Optional[str] = None
    attr_def_id: Optional[int] = None


class NoteAttributeOut(BaseModel):
    id: int
    key: str
    value: Optional[str]
    attr_def_id: Optional[int]


# ---------------------------------------------------------------------------
# Notes
# ---------------------------------------------------------------------------

class NoteCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    icon: Optional[str] = None
    content: Optional[str] = None
    meeting_date: date
    category_ids: list[int] = Field(default_factory=list)
    attributes: list[NoteAttributeIn] = Field(default_factory=list)


class NoteUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    icon: Optional[str] = None
    content: Optional[str] = None
    meeting_date: Optional[date] = None
    category_ids: Optional[list[int]] = None
    attributes: Optional[list[NoteAttributeIn]] = None


class NoteOut(BaseModel):
    id: int
    title: str
    icon: Optional[str] = None
    content: Optional[str]
    meeting_date: date
    created_at: datetime
    updated_at: datetime
    categories: list[CategoryOut] = Field(default_factory=list)
    attributes: list[NoteAttributeOut] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Search / Filter params
# ---------------------------------------------------------------------------

class NoteFilter(BaseModel):
    q: Optional[str] = None                # free text search
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    category_ids: list[int] = Field(default_factory=list)
