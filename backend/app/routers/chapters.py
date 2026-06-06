from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlmodel import select, func
from app.database import get_db
from app.models.chapter import Chapter, ChapterVersion, StoryBranch
from app.models.project import Project
from app.models.user import User
from app.routers.auth import get_current_user

router = APIRouter(prefix="/api/v1/projects/{project_id}/chapters", tags=["chapters"])


class ChapterCreate(BaseModel):
    title: str = ""
    content: str = ""


class ChapterUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None


class ChapterResponse(BaseModel):
    id: str
    project_id: str
    chapter_number: int
    title: str
    content: str
    word_count: int
    created_at: datetime
    updated_at: datetime


class ChapterListResponse(BaseModel):
    items: list[ChapterResponse]
    total: int


class VersionResponse(BaseModel):
    id: str
    chapter_id: str
    version_number: int
    content: str
    word_count: int
    is_locked: bool
    created_at: datetime


async def verify_project_ownership(project_id: str, user_id: str, db: AsyncSession) -> Project:
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.user_id == user_id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def count_words(text: str) -> int:
    # Count Chinese characters and English words
    import re
    chinese = len(re.findall(r'[一-鿿]', text))
    english = len(re.findall(r'[a-zA-Z]+', text))
    return chinese + english


@router.post("", response_model=ChapterResponse, status_code=status.HTTP_201_CREATED)
async def create_chapter(
    project_id: str,
    req: ChapterCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    await verify_project_ownership(project_id, current_user.id, db)

    # Get next chapter number
    result = await db.execute(
        select(func.max(Chapter.chapter_number)).where(Chapter.project_id == project_id)
    )
    max_number = result.scalar() or 0

    chapter = Chapter(
        project_id=project_id,
        chapter_number=max_number + 1,
        title=req.title,
        content=req.content,
        word_count=count_words(req.content)
    )
    db.add(chapter)
    await db.commit()
    await db.refresh(chapter)

    # Create initial version
    version = ChapterVersion(
        chapter_id=chapter.id,
        version_number=1,
        content=chapter.content,
        word_count=chapter.word_count
    )
    db.add(version)
    await db.commit()

    return ChapterResponse(
        id=chapter.id,
        project_id=chapter.project_id,
        chapter_number=chapter.chapter_number,
        title=chapter.title,
        content=chapter.content,
        word_count=chapter.word_count,
        created_at=chapter.created_at,
        updated_at=chapter.updated_at
    )


@router.get("", response_model=ChapterListResponse)
async def list_chapters(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    await verify_project_ownership(project_id, current_user.id, db)

    result = await db.execute(
        select(Chapter)
        .where(Chapter.project_id == project_id)
        .order_by(Chapter.chapter_number.asc())
    )
    chapters = result.scalars().all()

    return ChapterListResponse(
        items=[ChapterResponse(
            id=c.id,
            project_id=c.project_id,
            chapter_number=c.chapter_number,
            title=c.title,
            content=c.content,
            word_count=c.word_count,
            created_at=c.created_at,
            updated_at=c.updated_at
        ) for c in chapters],
        total=len(chapters)
    )


@router.get("/{chapter_id}", response_model=ChapterResponse)
async def get_chapter(
    project_id: str,
    chapter_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    await verify_project_ownership(project_id, current_user.id, db)

    result = await db.execute(
        select(Chapter).where(Chapter.id == chapter_id, Chapter.project_id == project_id)
    )
    chapter = result.scalar_one_or_none()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    return ChapterResponse(
        id=chapter.id,
        project_id=chapter.project_id,
        chapter_number=chapter.chapter_number,
        title=chapter.title,
        content=chapter.content,
        word_count=chapter.word_count,
        created_at=chapter.created_at,
        updated_at=chapter.updated_at
    )


@router.put("/{chapter_id}", response_model=ChapterResponse)
async def update_chapter(
    project_id: str,
    chapter_id: str,
    req: ChapterUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    await verify_project_ownership(project_id, current_user.id, db)

    result = await db.execute(
        select(Chapter).where(Chapter.id == chapter_id, Chapter.project_id == project_id)
    )
    chapter = result.scalar_one_or_none()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    if req.title is not None:
        chapter.title = req.title
    if req.content is not None:
        chapter.content = req.content
        chapter.word_count = count_words(req.content)
    chapter.updated_at = datetime.utcnow()

    # Save new version
    result = await db.execute(
        select(func.max(ChapterVersion.version_number))
        .where(ChapterVersion.chapter_id == chapter_id)
    )
    max_version = result.scalar() or 0

    version = ChapterVersion(
        chapter_id=chapter_id,
        version_number=max_version + 1,
        content=chapter.content,
        word_count=chapter.word_count
    )
    db.add(version)

    await db.commit()
    await db.refresh(chapter)

    return ChapterResponse(
        id=chapter.id,
        project_id=chapter.project_id,
        chapter_number=chapter.chapter_number,
        title=chapter.title,
        content=chapter.content,
        word_count=chapter.word_count,
        created_at=chapter.created_at,
        updated_at=chapter.updated_at
    )


@router.delete("/{chapter_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chapter(
    project_id: str,
    chapter_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    await verify_project_ownership(project_id, current_user.id, db)

    result = await db.execute(
        select(Chapter).where(Chapter.id == chapter_id, Chapter.project_id == project_id)
    )
    chapter = result.scalar_one_or_none()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    await db.delete(chapter)
    await db.commit()


@router.get("/{chapter_id}/versions", response_model=list[VersionResponse])
async def list_versions(
    project_id: str,
    chapter_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    await verify_project_ownership(project_id, current_user.id, db)

    result = await db.execute(
        select(ChapterVersion)
        .where(ChapterVersion.chapter_id == chapter_id)
        .order_by(ChapterVersion.version_number.desc())
    )
    versions = result.scalars().all()

    return [VersionResponse(
        id=v.id,
        chapter_id=v.chapter_id,
        version_number=v.version_number,
        content=v.content,
        word_count=v.word_count,
        is_locked=v.is_locked,
        created_at=v.created_at
    ) for v in versions]
