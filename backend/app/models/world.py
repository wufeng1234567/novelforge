from datetime import datetime
from typing import Optional
from sqlmodel import SQLModel, Field
import uuid


MODULE_TYPES = [
    "era",          # 时代背景
    "geography",    # 地理环境
    "magic",        # 魔法/科技体系
    "politics",     # 政治体系
    "race",         # 种族设定
    "religion",     # 宗教信仰
    "history",      # 历史事件
    "culture",      # 社会文化
    "economy",      # 经济体系
]


class WorldModule(SQLModel, table=True):
    __tablename__ = "world_modules"

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True, max_length=36)
    project_id: str = Field(max_length=36, index=True)
    module_type: str = Field(max_length=30)  # MODULE_TYPES 中的一种
    title: str = Field(default="", max_length=200)
    content: str = Field(default="")
    tags: Optional[str] = Field(default=None, max_length=500)  # 逗号分隔
    parent_id: Optional[str] = Field(default=None, max_length=36)
    sort_order: int = Field(default=0)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class WorldRule(SQLModel, table=True):
    __tablename__ = "world_rules"

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True, max_length=36)
    project_id: str = Field(max_length=36, index=True)
    content: str
    priority: int = Field(default=0)  # 越大越优先
    created_at: datetime = Field(default_factory=datetime.utcnow)
