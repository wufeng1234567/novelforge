import json
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlmodel import select
from app.database import get_db
from app.models.user import User
from app.models.chapter import Chapter
from app.models.project import Project, ProjectSetting
from app.routers.auth import get_current_user
import httpx

router = APIRouter(prefix="/api/v1/generate", tags=["generate"])


class StreamRequest(BaseModel):
    project_id: str
    chapter_id: Optional[str] = None
    prompt: str
    temperature: float = 0.7
    max_tokens: int = 4096
    model: Optional[str] = None


class OutlineRequest(BaseModel):
    project_id: str
    summary: str
    num_chapters: int = 10
    model: Optional[str] = None


class RewriteRequest(BaseModel):
    project_id: str
    chapter_id: str
    selected_text: str
    instruction: str
    temperature: float = 0.7
    model: Optional[str] = None


class SuggestionsRequest(BaseModel):
    project_id: str
    chapter_id: str
    model: Optional[str] = None


async def get_model_config(user: User, project_id: str, db: AsyncSession, model_override: Optional[str] = None):
    """Get model configuration for generation."""
    # Get project settings
    result = await db.execute(
        select(ProjectSetting).where(ProjectSetting.project_id == project_id)
    )
    settings = result.scalar_one_or_none()

    model_name = model_override or (settings.default_model if settings else "deepseek-chat")

    # Default to DeepSeek API
    return {
        "base_url": "https://api.deepseek.com/v1",
        "api_key": "",  # User should configure this
        "model": model_name,
        "temperature": settings.temperature if settings else 0.7,
        "max_tokens": settings.max_tokens if settings else 4096
    }


async def stream_ai_response(messages: list[dict], config: dict):
    """Stream AI response using SSE."""
    async with httpx.AsyncClient() as client:
        try:
            async with client.stream(
                "POST",
                f"{config['base_url']}/chat/completions",
                json={
                    "model": config["model"],
                    "messages": messages,
                    "temperature": config["temperature"],
                    "max_tokens": config["max_tokens"],
                    "stream": True
                },
                headers={
                    "Authorization": f"Bearer {config['api_key']}",
                    "Content-Type": "application/json"
                },
                timeout=120.0
            ) as response:
                if response.status_code == 429:
                    retry_after_str = response.headers.get("Retry-After", "60")
                    try:
                        retry_after = int(retry_after_str)
                    except (ValueError, TypeError):
                        retry_after = 60
                    yield f"data: {json.dumps({'error': f'DeepSeek API 请求过于频繁（429），请等待 {retry_after} 秒后再试', 'code': 429, 'retry_after': retry_after})}\n\n"
                    return
                if response.status_code != 200:
                    error_body = await response.aread()
                    yield f"data: {json.dumps({'error': f'DeepSeek API 返回错误: {response.status_code}'})}\n\n"
                    return

                buffer = ""
                async for chunk in response.aiter_text():
                    buffer += chunk
                    while "\n" in buffer:
                        line, buffer = buffer.split("\n", 1)
                        line = line.strip()
                        if line.startswith("data: "):
                            data = line[6:]
                            if data == "[DONE]":
                                yield "data: [DONE]\n\n"
                                return
                            try:
                                parsed = json.loads(data)
                                content = parsed.get("choices", [{}])[0].get("delta", {}).get("content", "")
                                if content:
                                    yield f"data: {json.dumps({'content': content})}\n\n"
                            except json.JSONDecodeError:
                                continue
        except httpx.TimeoutException:
            yield f"data: {json.dumps({'error': 'Request timeout'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"


@router.post("/stream")
async def generate_stream(
    req: StreamRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Verify project ownership
    result = await db.execute(
        select(Project).where(Project.id == req.project_id, Project.user_id == current_user.id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Project not found")

    # Get context from chapter if provided
    context = ""
    if req.chapter_id:
        result = await db.execute(
            select(Chapter).where(Chapter.id == req.chapter_id, Chapter.project_id == req.project_id)
        )
        chapter = result.scalar_one_or_none()
        if chapter:
            context = chapter.content

    config = await get_model_config(current_user, req.project_id, db, req.model)

    messages = [
        {"role": "system", "content": "你是一位专业的小说创作助手，擅长续写、改写和创作各种类型的小说内容。"},
    ]
    if context:
        messages.append({"role": "user", "content": f"以下是前文内容：\n\n{context[-2000:]}"})
    messages.append({"role": "user", "content": req.prompt})

    return StreamingResponse(
        stream_ai_response(messages, config),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@router.post("/outline")
async def generate_outline(
    req: OutlineRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Verify project ownership
    result = await db.execute(
        select(Project).where(Project.id == req.project_id, Project.user_id == current_user.id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Project not found")

    config = await get_model_config(current_user, req.project_id, db, req.model)

    messages = [
        {"role": "system", "content": "你是一位专业的小说大纲创作助手。请根据用户提供的故事梗概，生成详细的小说大纲。"},
        {"role": "user", "content": f"请根据以下梗概生成{req.num_chapters}章的小说大纲，每章包含标题和简要内容描述：\n\n{req.summary}"}
    ]

    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{config['base_url']}/chat/completions",
            json={
                "model": config["model"],
                "messages": messages,
                "temperature": config["temperature"],
                "max_tokens": config["max_tokens"]
            },
            headers={
                "Authorization": f"Bearer {config['api_key']}",
                "Content-Type": "application/json"
            },
            timeout=120.0
        )

        if response.status_code == 429:
            raise HTTPException(status_code=429, detail="DeepSeek API 请求过于频繁，请等待 60 秒后再试")
        if response.status_code != 200:
            raise HTTPException(status_code=500, detail="AI generation failed")

        result = response.json()
        content = result.get("choices", [{}])[0].get("message", {}).get("content", "")

        return {"outline": content, "model": config["model"]}


@router.post("/rewrite")
async def generate_rewrite(
    req: RewriteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Verify project ownership
    result = await db.execute(
        select(Project).where(Project.id == req.project_id, Project.user_id == current_user.id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Project not found")

    config = await get_model_config(current_user, req.project_id, db, req.model)

    messages = [
        {"role": "system", "content": "你是一位专业的小说改写助手。请按照用户的要求对选中的文本进行改写。"},
        {"role": "user", "content": f"请按照以下要求改写这段文字：\n\n要求：{req.instruction}\n\n原文：\n{req.selected_text}"}
    ]

    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{config['base_url']}/chat/completions",
            json={
                "model": config["model"],
                "messages": messages,
                "temperature": req.temperature,
                "max_tokens": config["max_tokens"]
            },
            headers={
                "Authorization": f"Bearer {config['api_key']}",
                "Content-Type": "application/json"
            },
            timeout=120.0
        )

        if response.status_code == 429:
            raise HTTPException(status_code=429, detail="DeepSeek API 请求过于频繁，请等待 60 秒后再试")
        if response.status_code != 200:
            raise HTTPException(status_code=500, detail="AI generation failed")

        result = response.json()
        content = result.get("choices", [{}])[0].get("message", {}).get("content", "")

        return {"rewritten_text": content, "model": config["model"]}


@router.post("/suggestions")
async def generate_suggestions(
    req: SuggestionsRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Verify project ownership
    result = await db.execute(
        select(Project).where(Project.id == req.project_id, Project.user_id == current_user.id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Project not found")

    # Get chapter content
    result = await db.execute(
        select(Chapter).where(Chapter.id == req.chapter_id, Chapter.project_id == req.project_id)
    )
    chapter = result.scalar_one_or_none()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    config = await get_model_config(current_user, req.project_id, db, req.model)

    messages = [
        {"role": "system", "content": "你是一位专业的小说创作顾问。请根据当前剧情提供3-5个可能的发展方向。"},
        {"role": "user", "content": f"以下是当前章节内容：\n\n{chapter.content[-2000:]}\n\n请提供3-5个情节发展方向建议。"}
    ]

    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{config['base_url']}/chat/completions",
            json={
                "model": config["model"],
                "messages": messages,
                "temperature": 0.8,
                "max_tokens": 1000
            },
            headers={
                "Authorization": f"Bearer {config['api_key']}",
                "Content-Type": "application/json"
            },
            timeout=60.0
        )

        if response.status_code != 200:
            raise HTTPException(status_code=500, detail="AI generation failed")

        result = response.json()
        content = result.get("choices", [{}])[0].get("message", {}).get("content", "")

        return {"suggestions": content, "model": config["model"]}
