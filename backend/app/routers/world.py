from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query, Body
from pydantic import BaseModel
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlmodel import select
from app.database import get_db
from app.models.world import WorldModule, WorldRule, MODULE_TYPES
from app.models.project import Project
from app.models.user import User
from app.routers.auth import get_current_user

router = APIRouter(prefix="/api/v1/projects/{project_id}", tags=["world"])


async def verify_project(project_id: str, user_id: str, db: AsyncSession) -> Project:
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.user_id == user_id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


# --- WorldModule schemas ---

class WorldModuleCreate(BaseModel):
    module_type: str
    title: str = ""
    content: str = ""
    tags: Optional[str] = None
    parent_id: Optional[str] = None
    sort_order: int = 0


class WorldModuleUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    tags: Optional[str] = None
    parent_id: Optional[str] = None
    sort_order: Optional[int] = None


class WorldModuleResponse(BaseModel):
    id: str
    project_id: str
    module_type: str
    title: str
    content: str
    tags: Optional[str]
    parent_id: Optional[str]
    sort_order: int
    created_at: datetime
    updated_at: datetime


# --- WorldModule endpoints ---

@router.post("/world", response_model=WorldModuleResponse, status_code=status.HTTP_201_CREATED)
async def create_world_module(
    project_id: str, req: WorldModuleCreate, db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    await verify_project(project_id, current_user.id, db)
    if req.module_type not in MODULE_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid module_type. Must be one of: {MODULE_TYPES}")
    module = WorldModule(project_id=project_id, **req.model_dump())
    db.add(module)
    await db.commit()
    await db.refresh(module)
    return WorldModuleResponse.model_validate(module)


@router.get("/world", response_model=list[WorldModuleResponse])
async def list_world_modules(
    project_id: str, module_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)
):
    await verify_project(project_id, current_user.id, db)
    query = select(WorldModule).where(WorldModule.project_id == project_id)
    if module_type:
        query = query.where(WorldModule.module_type == module_type)
    query = query.order_by(WorldModule.sort_order.asc())
    result = await db.execute(query)
    return [WorldModuleResponse.model_validate(m.model_dump()) for m in result.scalars().all()]


@router.put("/world/{module_id}", response_model=WorldModuleResponse)
async def update_world_module(
    project_id: str, module_id: str, req: WorldModuleUpdate,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)
):
    await verify_project(project_id, current_user.id, db)
    result = await db.execute(
        select(WorldModule).where(WorldModule.id == module_id, WorldModule.project_id == project_id)
    )
    module = result.scalar_one_or_none()
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")
    for field, value in req.model_dump(exclude_unset=True).items():
        setattr(module, field, value)
    module.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(module)
    return WorldModuleResponse.model_validate(module)


@router.delete("/world/batch", status_code=status.HTTP_204_NO_CONTENT)
async def delete_world_modules_batch(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    await verify_project(project_id, current_user.id, db)
    result = await db.execute(
        select(WorldModule).where(WorldModule.project_id == project_id)
    )
    modules = result.scalars().all()
    for module in modules:
        await db.delete(module)
    await db.commit()


@router.delete("/world/{module_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_world_module(
    project_id: str, module_id: str,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)
):
    await verify_project(project_id, current_user.id, db)
    result = await db.execute(
        select(WorldModule).where(WorldModule.id == module_id, WorldModule.project_id == project_id)
    )
    module = result.scalar_one_or_none()
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")
    await db.delete(module)
    await db.commit()


# --- WorldRule schemas ---

class WorldRuleCreate(BaseModel):
    content: str
    priority: int = 0


class WorldRuleUpdate(BaseModel):
    content: Optional[str] = None
    priority: Optional[int] = None


class WorldRuleResponse(BaseModel):
    id: str
    project_id: str
    content: str
    priority: int
    created_at: datetime


# --- WorldRule endpoints ---

@router.post("/world-rules", response_model=WorldRuleResponse, status_code=status.HTTP_201_CREATED)
async def create_world_rule(
    project_id: str, req: WorldRuleCreate, db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    await verify_project(project_id, current_user.id, db)
    rule = WorldRule(project_id=project_id, **req.model_dump())
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return WorldRuleResponse.model_validate(rule.model_dump())


@router.get("/world-rules", response_model=list[WorldRuleResponse])
async def list_world_rules(
    project_id: str, db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    await verify_project(project_id, current_user.id, db)
    result = await db.execute(
        select(WorldRule).where(WorldRule.project_id == project_id).order_by(WorldRule.priority.desc())
    )
    return [WorldRuleResponse.model_validate(r.model_dump()) for r in result.scalars().all()]


@router.put("/world-rules/{rule_id}", response_model=WorldRuleResponse)
async def update_world_rule(
    project_id: str, rule_id: str, req: WorldRuleUpdate,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)
):
    await verify_project(project_id, current_user.id, db)
    result = await db.execute(
        select(WorldRule).where(WorldRule.id == rule_id, WorldRule.project_id == project_id)
    )
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    for field, value in req.model_dump(exclude_unset=True).items():
        setattr(rule, field, value)
    await db.commit()
    await db.refresh(rule)
    return WorldRuleResponse.model_validate(rule.model_dump())


@router.delete("/world-rules/batch", status_code=status.HTTP_204_NO_CONTENT)
async def delete_world_rules_batch(
    project_id: str, rule_ids: list[str] = Body(...),
    db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)
):
    await verify_project(project_id, current_user.id, db)
    result = await db.execute(
        select(WorldRule).where(
            WorldRule.id.in_(rule_ids),
            WorldRule.project_id == project_id
        )
    )
    rules = result.scalars().all()
    for rule in rules:
        await db.delete(rule)
    await db.commit()


@router.delete("/world-rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_world_rule(
    project_id: str, rule_id: str,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)
):
    await verify_project(project_id, current_user.id, db)
    result = await db.execute(
        select(WorldRule).where(WorldRule.id == rule_id, WorldRule.project_id == project_id)
    )
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    await db.delete(rule)
    await db.commit()
