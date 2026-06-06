from datetime import datetime
from typing import Optional
from sqlmodel import SQLModel, Field
import uuid


class Chapter(SQLModel, table=True):
    __tablename__ = "chapters"

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True, max_length=36)
    project_id: str = Field(max_length=36, index=True)
    chapter_number: int
    title: str = Field(default="", max_length=200)
    content: str = Field(default="")
    word_count: int = Field(default=0)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class ChapterVersion(SQLModel, table=True):
    __tablename__ = "chapter_versions"

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True, max_length=36)
    chapter_id: str = Field(max_length=36, index=True)
    version_number: int
    content: str
    word_count: int = Field(default=0)
    is_locked: bool = Field(default=False)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class StoryBranch(SQLModel, table=True):
    __tablename__ = "story_branches"

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True, max_length=36)
    project_id: str = Field(max_length=36, index=True)
    name: str = Field(max_length=100)
    description: Optional[str] = Field(default=None, max_length=500)
    parent_chapter_id: Optional[str] = Field(default=None, max_length=36)
    created_at: datetime = Field(default_factory=datetime.utcnow)
