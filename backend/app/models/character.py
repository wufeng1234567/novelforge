from datetime import datetime
from typing import Optional
from sqlmodel import SQLModel, Field
import uuid


class Character(SQLModel, table=True):
    __tablename__ = "characters"

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True, max_length=36)
    project_id: str = Field(max_length=36, index=True)
    name: str = Field(max_length=100)
    avatar_url: Optional[str] = Field(default=None, max_length=500)
    gender: Optional[str] = Field(default=None, max_length=20)
    age: Optional[str] = Field(default=None, max_length=50)
    appearance: Optional[str] = Field(default=None)  # 外貌描述
    personality: Optional[str] = Field(default=None)  # 性格描述
    abilities: Optional[str] = Field(default=None)    # 能力/技能
    background: Optional[str] = Field(default=None)   # 背景故事
    status: Optional[str] = Field(default=None, max_length=50)  # 当前状态
    quotes: Optional[str] = Field(default=None)       # 经典语录
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class CharacterRelationship(SQLModel, table=True):
    __tablename__ = "character_relationships"

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True, max_length=36)
    project_id: str = Field(max_length=36, index=True)
    from_char_id: str = Field(max_length=36, index=True)
    to_char_id: str = Field(max_length=36, index=True)
    relation_type: str = Field(max_length=50)  # 亲人/朋友/敌人/恋人/师徒/上下级 等
    intimacy: int = Field(default=50)  # 0-100
    description: Optional[str] = Field(default=None, max_length=500)
    created_at: datetime = Field(default_factory=datetime.utcnow)
