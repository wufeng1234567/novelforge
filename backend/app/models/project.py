from datetime import datetime
from typing import Optional
from sqlmodel import SQLModel, Field
import uuid


class Project(SQLModel, table=True):
    __tablename__ = "projects"

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True, max_length=36)
    user_id: str = Field(max_length=36, index=True)
    title: str = Field(max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)
    genre: Optional[str] = Field(default=None, max_length=50)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class ProjectSetting(SQLModel, table=True):
    __tablename__ = "project_settings"

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True, max_length=36)
    project_id: str = Field(unique=True, max_length=36)
    default_model: Optional[str] = Field(default=None, max_length=100)
    temperature: float = Field(default=0.7)
    max_tokens: int = Field(default=4096)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
