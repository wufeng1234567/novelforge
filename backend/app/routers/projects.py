from datetime import datetime
import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlmodel import select, func
from app.database import get_db
from app.models.project import Project, ProjectSetting
from app.models.user import User
from app.routers.auth import get_current_user

logger = logging.getLogger("projects")
router = APIRouter(prefix="/api/v1/projects", tags=["projects"])


class ProjectCreate(BaseModel):
    title: str
    description: Optional[str] = None
    genre: Optional[str] = None


class ProjectUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    genre: Optional[str] = None


class ProjectResponse(BaseModel):
    id: str
    title: str
    description: Optional[str]
    genre: Optional[str]
    created_at: datetime
    updated_at: datetime


class ProjectListResponse(BaseModel):
    items: list[ProjectResponse]
    total: int
    page: int
    page_size: int


class ProjectSettingUpdate(BaseModel):
    default_model: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None


class ProjectSettingResponse(BaseModel):
    id: str
    project_id: str
    default_model: Optional[str]
    temperature: float
    max_tokens: int


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    req: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    project = Project(
        user_id=current_user.id,
        title=req.title,
        description=req.description,
        genre=req.genre
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)

    # Create default settings
    settings = ProjectSetting(project_id=project.id)
    db.add(settings)
    await db.commit()

    return ProjectResponse(
        id=project.id,
        title=project.title,
        description=project.description,
        genre=project.genre,
        created_at=project.created_at,
        updated_at=project.updated_at
    )


@router.get("", response_model=ProjectListResponse)
async def list_projects(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
    sort_by: str = Query("updated_at", pattern="^(created_at|updated_at|title)$"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    logger.info(f"[LIST_PROJECTS] user_id={current_user.id}, username={current_user.username}")
    query = select(Project).where(Project.user_id == current_user.id)

    if search:
        query = query.where(Project.title.contains(search))

    # Count total
    count_query = select(func.count()).select_from(Project).where(Project.user_id == current_user.id)
    if search:
        count_query = count_query.where(Project.title.contains(search))
    result = await db.execute(count_query)
    total = result.scalar()

    # Sort
    sort_column = getattr(Project, sort_by)
    if sort_order == "desc":
        query = query.order_by(sort_column.desc())
    else:
        query = query.order_by(sort_column.asc())

    # Paginate
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    projects = result.scalars().all()

    return ProjectListResponse(
        items=[ProjectResponse(
            id=p.id,
            title=p.title,
            description=p.description,
            genre=p.genre,
            created_at=p.created_at,
            updated_at=p.updated_at
        ) for p in projects],
        total=total,
        page=page,
        page_size=page_size
    )


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.user_id == current_user.id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    return ProjectResponse(
        id=project.id,
        title=project.title,
        description=project.description,
        genre=project.genre,
        created_at=project.created_at,
        updated_at=project.updated_at
    )


@router.put("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: str,
    req: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.user_id == current_user.id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if req.title is not None:
        project.title = req.title
    if req.description is not None:
        project.description = req.description
    if req.genre is not None:
        project.genre = req.genre
    project.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(project)

    return ProjectResponse(
        id=project.id,
        title=project.title,
        description=project.description,
        genre=project.genre,
        created_at=project.created_at,
        updated_at=project.updated_at
    )


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.user_id == current_user.id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    await db.delete(project)
    await db.commit()


@router.get("/{project_id}/settings", response_model=ProjectSettingResponse)
async def get_project_settings(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Verify project ownership
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.user_id == current_user.id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Project not found")

    result = await db.execute(
        select(ProjectSetting).where(ProjectSetting.project_id == project_id)
    )
    settings = result.scalar_one_or_none()
    if not settings:
        settings = ProjectSetting(project_id=project_id)
        db.add(settings)
        await db.commit()
        await db.refresh(settings)

    return ProjectSettingResponse(
        id=settings.id,
        project_id=settings.project_id,
        default_model=settings.default_model,
        temperature=settings.temperature,
        max_tokens=settings.max_tokens
    )


@router.put("/{project_id}/settings", response_model=ProjectSettingResponse)
async def update_project_settings(
    project_id: str,
    req: ProjectSettingUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Verify project ownership
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.user_id == current_user.id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Project not found")

    result = await db.execute(
        select(ProjectSetting).where(ProjectSetting.project_id == project_id)
    )
    settings = result.scalar_one_or_none()
    if not settings:
        settings = ProjectSetting(project_id=project_id)
        db.add(settings)

    if req.default_model is not None:
        settings.default_model = req.default_model
    if req.temperature is not None:
        settings.temperature = req.temperature
    if req.max_tokens is not None:
        settings.max_tokens = req.max_tokens
    settings.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(settings)

    return ProjectSettingResponse(
        id=settings.id,
        project_id=settings.project_id,
        default_model=settings.default_model,
        temperature=settings.temperature,
        max_tokens=settings.max_tokens
    )
