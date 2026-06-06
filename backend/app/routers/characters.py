from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlmodel import select
from app.database import get_db
from app.models.character import Character, CharacterRelationship
from app.models.project import Project
from app.models.user import User
from app.routers.auth import get_current_user

router = APIRouter(prefix="/api/v1/projects/{project_id}/characters", tags=["characters"])


async def verify_project(project_id: str, user_id: str, db: AsyncSession) -> Project:
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.user_id == user_id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


# --- Character schemas ---

class CharacterCreate(BaseModel):
    name: str
    gender: Optional[str] = None
    age: Optional[str] = None
    appearance: Optional[str] = None
    personality: Optional[str] = None
    abilities: Optional[str] = None
    background: Optional[str] = None
    status: Optional[str] = None
    quotes: Optional[str] = None


class CharacterUpdate(BaseModel):
    name: Optional[str] = None
    gender: Optional[str] = None
    age: Optional[str] = None
    appearance: Optional[str] = None
    personality: Optional[str] = None
    abilities: Optional[str] = None
    background: Optional[str] = None
    status: Optional[str] = None
    quotes: Optional[str] = None


class CharacterResponse(BaseModel):
    id: str
    project_id: str
    name: str
    avatar_url: Optional[str]
    gender: Optional[str]
    age: Optional[str]
    appearance: Optional[str]
    personality: Optional[str]
    abilities: Optional[str]
    background: Optional[str]
    status: Optional[str]
    quotes: Optional[str]
    created_at: datetime
    updated_at: datetime


# --- Relationship schemas ---

class RelationshipCreate(BaseModel):
    from_char_id: str
    to_char_id: str
    relation_type: str
    intimacy: int = 50
    description: Optional[str] = None


class RelationshipResponse(BaseModel):
    id: str
    project_id: str
    from_char_id: str
    to_char_id: str
    relation_type: str
    intimacy: int
    description: Optional[str]
    created_at: datetime


# --- Character endpoints ---

@router.post("", response_model=CharacterResponse, status_code=status.HTTP_201_CREATED)
async def create_character(
    project_id: str, req: CharacterCreate, db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    await verify_project(project_id, current_user.id, db)
    char = Character(project_id=project_id, **req.model_dump())
    db.add(char)
    await db.commit()
    await db.refresh(char)
    return CharacterResponse.model_validate(char.model_dump())


@router.get("", response_model=list[CharacterResponse])
async def list_characters(
    project_id: str, db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    await verify_project(project_id, current_user.id, db)
    result = await db.execute(
        select(Character).where(Character.project_id == project_id).order_by(Character.created_at.asc())
    )
    return [CharacterResponse.model_validate(c.model_dump()) for c in result.scalars().all()]


@router.get("/relationships", response_model=list[RelationshipResponse])
async def list_relationships(
    project_id: str, db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    await verify_project(project_id, current_user.id, db)
    result = await db.execute(
        select(CharacterRelationship).where(CharacterRelationship.project_id == project_id)
    )
    return [RelationshipResponse.model_validate(r.model_dump()) for r in result.scalars().all()]


@router.post("/relationships", response_model=RelationshipResponse, status_code=status.HTTP_201_CREATED)
async def create_relationship(
    project_id: str, req: RelationshipCreate, db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    await verify_project(project_id, current_user.id, db)
    rel = CharacterRelationship(project_id=project_id, **req.model_dump())
    db.add(rel)
    await db.commit()
    await db.refresh(rel)
    return RelationshipResponse.model_validate(rel)


@router.put("/relationships/{rel_id}", response_model=RelationshipResponse)
async def update_relationship(
    project_id: str, rel_id: str, req: RelationshipCreate, db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    await verify_project(project_id, current_user.id, db)
    result = await db.execute(
        select(CharacterRelationship).where(
            CharacterRelationship.id == rel_id,
            CharacterRelationship.project_id == project_id
        )
    )
    rel = result.scalar_one_or_none()
    if not rel:
        raise HTTPException(status_code=404, detail="关系不存在")
    for key, value in req.model_dump().items():
        setattr(rel, key, value)
    await db.commit()
    await db.refresh(rel)
    return RelationshipResponse.model_validate(rel)


@router.delete("/relationships/{rel_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_relationship(
    project_id: str, rel_id: str, db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    await verify_project(project_id, current_user.id, db)
    result = await db.execute(
        select(CharacterRelationship).where(
            CharacterRelationship.id == rel_id, CharacterRelationship.project_id == project_id
        )
    )
    rel = result.scalar_one_or_none()
    if not rel:
        raise HTTPException(status_code=404, detail="Relationship not found")
    await db.delete(rel)
    await db.commit()


@router.get("/{char_id}", response_model=CharacterResponse)
async def get_character(
    project_id: str, char_id: str, db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    await verify_project(project_id, current_user.id, db)
    result = await db.execute(
        select(Character).where(Character.id == char_id, Character.project_id == project_id)
    )
    char = result.scalar_one_or_none()
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")
    return CharacterResponse.model_validate(char.model_dump())


@router.put("/{char_id}", response_model=CharacterResponse)
async def update_character(
    project_id: str, char_id: str, req: CharacterUpdate,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)
):
    await verify_project(project_id, current_user.id, db)
    result = await db.execute(
        select(Character).where(Character.id == char_id, Character.project_id == project_id)
    )
    char = result.scalar_one_or_none()
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")
    for field, value in req.model_dump(exclude_unset=True).items():
        setattr(char, field, value)
    char.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(char)
    return CharacterResponse.model_validate(char.model_dump())


@router.delete("/{char_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_character(
    project_id: str, char_id: str, db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    await verify_project(project_id, current_user.id, db)
    result = await db.execute(
        select(Character).where(Character.id == char_id, Character.project_id == project_id)
    )
    char = result.scalar_one_or_none()
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")
    await db.delete(char)
    await db.commit()


@router.delete("/batch", status_code=status.HTTP_204_NO_CONTENT)
async def delete_characters_batch(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    await verify_project(project_id, current_user.id, db)
    result = await db.execute(
        select(Character).where(Character.project_id == project_id)
    )
    chars = result.scalars().all()
    for char in chars:
        await db.delete(char)
    await db.commit()


@router.delete("/relationships/batch", status_code=status.HTTP_204_NO_CONTENT)
async def delete_relationships_batch(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    await verify_project(project_id, current_user.id, db)
    result = await db.execute(
        select(CharacterRelationship).where(CharacterRelationship.project_id == project_id)
    )
    rels = result.scalars().all()
    for rel in rels:
        await db.delete(rel)
    await db.commit()


# --- Relationship endpoints --- (moved before /{char_id} to avoid route conflict)
