import json
import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlmodel import select
from app.database import get_db
from app.models.user import User
from app.models.project import Project
from app.models.world import WorldModule, WorldRule
from app.models.character import Character, CharacterRelationship
from app.models.chapter import Chapter
from app.routers.auth import get_current_user

logger = logging.getLogger("import_data")
router = APIRouter(prefix="/api/v1/import", tags=["import"])


class WorldModuleImport(BaseModel):
    module_type: str
    title: str = ""
    content: str = ""
    tags: str = ""


class WorldRuleImport(BaseModel):
    content: str
    priority: int = 0


class CharacterImport(BaseModel):
    name: str
    gender: str = ""
    age: str = ""
    appearance: str = ""
    personality: str = ""
    abilities: str = ""
    background: str = ""
    status: str = ""
    quotes: str = ""


class RelationshipImport(BaseModel):
    from_name: str  # 用名字匹配，不用id
    to_name: str
    relation_type: str
    intimacy: int = 50
    description: str = ""


class ImportRequest(BaseModel):
    world_modules: list[WorldModuleImport] = []
    world_rules: list[WorldRuleImport] = []
    characters: list[CharacterImport] = []
    relationships: list[RelationshipImport] = []
    # 是否清除已有数据后再导入
    clear_world_modules: bool = False
    clear_world_rules: bool = False
    clear_characters: bool = False
    clear_relationships: bool = False


class ImportResult(BaseModel):
    world_modules_created: int = 0
    world_rules_created: int = 0
    characters_created: int = 0
    relationships_created: int = 0
    errors: list[str] = []


@router.post("/{project_id}", response_model=ImportResult)
async def import_data(
    project_id: str, req: ImportRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Batch import world modules, rules, characters and relationships from structured JSON."""
    # Verify project ownership
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.user_id == current_user.id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Project not found")

    import_result = ImportResult()
    char_name_map = {}  # name -> id mapping for relationships

    # 清除已有数据（如果用户选择覆盖模式）
    if req.clear_world_modules:
        existing = await db.execute(select(WorldModule).where(WorldModule.project_id == project_id))
        for m in existing.scalars().all():
            await db.delete(m)
        logger.info(f"Cleared existing world modules for project {project_id}")

    if req.clear_world_rules:
        existing = await db.execute(select(WorldRule).where(WorldRule.project_id == project_id))
        for r in existing.scalars().all():
            await db.delete(r)
        logger.info(f"Cleared existing world rules for project {project_id}")

    if req.clear_characters:
        existing = await db.execute(select(Character).where(Character.project_id == project_id))
        for c in existing.scalars().all():
            await db.delete(c)
        # 同时清除角色关系
        existing_rels = await db.execute(select(CharacterRelationship).where(CharacterRelationship.project_id == project_id))
        for r in existing_rels.scalars().all():
            await db.delete(r)
        logger.info(f"Cleared existing characters and relationships for project {project_id}")

    if req.clear_relationships:
        existing = await db.execute(select(CharacterRelationship).where(CharacterRelationship.project_id == project_id))
        for r in existing.scalars().all():
            await db.delete(r)
        logger.info(f"Cleared existing relationships for project {project_id}")

    # Import world modules
    for m in req.world_modules:
        try:
            module = WorldModule(
                project_id=project_id,
                module_type=m.module_type,
                title=m.title,
                content=m.content,
                tags=m.tags if m.tags else None
            )
            db.add(module)
            import_result.world_modules_created += 1
        except Exception as e:
            import_result.errors.append(f"世界观模块 '{m.title}': {str(e)}")

    # Import world rules
    for r in req.world_rules:
        try:
            rule = WorldRule(project_id=project_id, content=r.content, priority=r.priority)
            db.add(rule)
            import_result.world_rules_created += 1
        except Exception as e:
            import_result.errors.append(f"硬规则 '{r.content[:20]}': {str(e)}")

    # Import characters
    for c in req.characters:
        try:
            char = Character(
                project_id=project_id,
                name=c.name,
                gender=c.gender or None,
                age=c.age or None,
                appearance=c.appearance or None,
                personality=c.personality or None,
                abilities=c.abilities or None,
                background=c.background or None,
                status=c.status or None,
                quotes=c.quotes or None
            )
            db.add(char)
            await db.flush()  # flush to get the id
            char_name_map[c.name] = char.id
            import_result.characters_created += 1
        except Exception as e:
            import_result.errors.append(f"角色 '{c.name}': {str(e)}")

    # Import relationships (after characters are flushed)
    for rel in req.relationships:
        try:
            from_id = char_name_map.get(rel.from_name)
            to_id = char_name_map.get(rel.to_name)
            if not from_id or not to_id:
                # Try to find in existing DB
                if not from_id:
                    existing = await db.execute(
                        select(Character).where(
                            Character.project_id == project_id,
                            Character.name == rel.from_name
                        )
                    )
                    char_obj = existing.scalar_one_or_none()
                    if char_obj:
                        from_id = char_obj.id
                if not to_id:
                    existing = await db.execute(
                        select(Character).where(
                            Character.project_id == project_id,
                            Character.name == rel.to_name
                        )
                    )
                    char_obj = existing.scalar_one_or_none()
                    if char_obj:
                        to_id = char_obj.id

            if not from_id or not to_id:
                import_result.errors.append(f"关系 '{rel.from_name}→{rel.to_name}': 角色未找到")
                continue

            relationship = CharacterRelationship(
                project_id=project_id,
                from_char_id=from_id,
                to_char_id=to_id,
                relation_type=rel.relation_type,
                intimacy=rel.intimacy,
                description=rel.description or None
            )
            db.add(relationship)
            import_result.relationships_created += 1
        except Exception as e:
            import_result.errors.append(f"关系 '{rel.from_name}→{rel.to_name}': {str(e)}")

    await db.commit()
    logger.info(f"Import result: {import_result}")
    return import_result


class ProjectSettingsSummary(BaseModel):
    world_modules: list[dict] = []
    world_rules: list[dict] = []
    characters: list[dict] = []
    relationships: list[dict] = []


@router.get("/{project_id}/settings")
async def get_project_settings(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取项目已有设定摘要，用于冲突检测"""
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.user_id == current_user.id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Project not found")

    # 世界观模块
    modules_result = await db.execute(
        select(WorldModule).where(WorldModule.project_id == project_id)
    )
    modules = [
        {"id": m.id, "module_type": m.module_type, "title": m.title}
        for m in modules_result.scalars().all()
    ]

    # 硬规则
    rules_result = await db.execute(
        select(WorldRule).where(WorldRule.project_id == project_id)
    )
    rules = [
        {"id": r.id, "content": r.content[:50], "priority": r.priority}
        for r in rules_result.scalars().all()
    ]

    # 角色
    chars_result = await db.execute(
        select(Character).where(Character.project_id == project_id)
    )
    chars = [
        {"id": c.id, "name": c.name}
        for c in chars_result.scalars().all()
    ]

    # 关系
    rels_result = await db.execute(
        select(CharacterRelationship).where(CharacterRelationship.project_id == project_id)
    )
    rels = []
    for r in rels_result.scalars().all():
        from_c = await db.get(Character, r.from_char_id)
        to_c = await db.get(Character, r.to_char_id)
        rels.append({
            "id": r.id,
            "from_name": from_c.name if from_c else "?",
            "to_name": to_c.name if to_c else "?",
            "relation_type": r.relation_type
        })

    return {
        "world_modules": modules,
        "world_rules": rules,
        "characters": chars,
        "relationships": rels
    }


@router.get("/{project_id}/full-context")
async def get_full_context(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取项目完整上下文（格式化为提示词），用于生成设定时参考已有内容"""
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.user_id == current_user.id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    parts = [f"# 项目：{project.title}\n"]

    # 世界观模块
    modules_result = await db.execute(
        select(WorldModule).where(WorldModule.project_id == project_id)
    )
    modules = modules_result.scalars().all()
    if modules:
        type_names = {
            "era": "时代背景", "geography": "地理环境", "magic": "魔法/科技体系",
            "politics": "政治体系", "race": "种族设定", "religion": "宗教信仰",
            "history": "历史事件", "culture": "社会文化", "economy": "经济体系"
        }
        parts.append("## 世界观设定\n")
        for m in modules:
            label = type_names.get(m.module_type, m.module_type)
            parts.append(f"### {label} - {m.title}\n{m.content}\n")

    # 硬规则
    rules_result = await db.execute(
        select(WorldRule).where(WorldRule.project_id == project_id).order_by(WorldRule.priority.desc())
    )
    rules = rules_result.scalars().all()
    if rules:
        parts.append("## 硬规则\n")
        for r in rules:
            parts.append(f"- [优先级{r.priority}] {r.content}")
        parts.append("")

    # 角色
    chars_result = await db.execute(
        select(Character).where(Character.project_id == project_id)
    )
    chars = chars_result.scalars().all()
    if chars:
        parts.append("## 角色设定\n")
        char_map = {c.id: c.name for c in chars}
        for c in chars:
            parts.append(f"### {c.name}")
            if c.gender: parts.append(f"- 性别: {c.gender}")
            if c.age: parts.append(f"- 年龄: {c.age}")
            if c.appearance: parts.append(f"- 外貌: {c.appearance}")
            if c.personality: parts.append(f"- 性格: {c.personality}")
            if c.abilities: parts.append(f"- 能力: {c.abilities}")
            if c.background: parts.append(f"- 背景: {c.background}")
            if c.status: parts.append(f"- 状态: {c.status}")
            if c.quotes: parts.append(f"- 语录: {c.quotes}")
            parts.append("")

        # 角色关系
        rels_result = await db.execute(
            select(CharacterRelationship).where(CharacterRelationship.project_id == project_id)
        )
        rels = rels_result.scalars().all()
        if rels:
            parts.append("## 角色关系\n")
            for r in rels:
                from_name = char_map.get(r.from_char_id, "?")
                to_name = char_map.get(r.to_char_id, "?")
                parts.append(f"- {from_name} → {to_name}: {r.relation_type} (亲密度: {r.intimacy})")
                if r.description:
                    parts.append(f"  {r.description}")
            parts.append("")

    # 最近 15 个章节
    chapters_result = await db.execute(
        select(Chapter).where(Chapter.project_id == project_id).order_by(Chapter.chapter_number.desc()).limit(15)
    )
    chapters = chapters_result.scalars().all()
    if chapters:
        parts.append("## 最近章节\n")
        for ch in sorted(chapters, key=lambda c: c.chapter_number):
            content_preview = ch.content[:500] if ch.content else ""
            # 去掉 HTML 标签
            import re
            content_preview = re.sub(r'<[^>]+>', '', content_preview).strip()
            parts.append(f"### 第{ch.chapter_number}章 {ch.title or '无标题'}\n{content_preview}...\n")

    return {"context": "\n".join(parts)}
