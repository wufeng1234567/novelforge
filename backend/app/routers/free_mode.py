import asyncio
import base64
import uuid
import json
import logging
import threading
import time
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlmodel import select
from app.config import get_settings
from app.database import get_db
from app.models.user import User
from app.models.project import Project
from app.models.world import WorldModule, WorldRule
from app.models.character import Character, CharacterRelationship
from app.routers.auth import get_current_user
import httpx

logger = logging.getLogger("free_mode")
router = APIRouter(prefix="/api/v1/free-deepseek", tags=["free-deepseek"])

_sessions: dict = {}
_cookie_store: dict = {"cookie": ""}
_last_request_time: dict = {}  # user_id -> timestamp, 用于频率限制
_REQUEST_COOLDOWN = 30  # 每次请求至少间隔 30 秒
_MAX_RETRIES = 3  # DeepSeek 429 时最多自动重试次数

# 扩展同源聊天任务队列
_chat_tasks: dict = {}
_ds_states: dict = {}  # task_id → 'idle' | 'generating' | 'continue'  # task_id -> {user_id, messages, temperature, status, queue, created_at}

# 扩展 SSE 连接状态追踪
_extension_connections: dict = {}  # user_id -> {"connected_at": timestamp, "last_heartbeat": timestamp}
_EXTENSION_TIMEOUT = 30  # 30秒无心跳视为断开

# 前端 WebSocket 连接追踪
_ws_clients: dict = {}  # user_id -> set[WebSocket]


async def _broadcast_to_ws(user_id: str, message: dict):
    clients = _ws_clients.get(user_id)
    msg_type = message.get("type", "unknown")
    msg_connected = message.get("connected")
    logger.info(f"[NF_WS] Broadcast to user {user_id}: type={msg_type}, connected={msg_connected}, clients_count={len(clients) if clients else 0}")
    if not clients:
        logger.info(f"[NF_WS] No WS clients for user {user_id}, broadcast skipped")
        return
    msg = json.dumps(message)
    dead = []
    for ws in clients:
        try:
            await ws.send_text(msg)
            logger.info(f"[NF_WS] Sent to WS client OK")
        except Exception as e:
            logger.warning(f"[NF_WS] Failed to send to WS client: {e}")
            dead.append(ws)
    for ws in dead:
        clients.discard(ws)
        logger.info(f"[NF_WS] Removed dead WS client, remaining={len(clients)}")


class StartResponse(BaseModel):
    session_id: str


class InjectRequest(BaseModel):
    project_id: str
    character_ids: list[str] = []
    module_types: list[str] = []
    prompt: str = ""


class InjectResponse(BaseModel):
    system_prompt: str
    status: str


async def _build_context_prompt(project_id: str, character_ids: list[str], module_types: list[str], db: AsyncSession) -> str:
    parts = ["你是一位专业的小说创作助手。以下是当前小说的世界观和角色设定，请基于这些设定来辅助创作。\n"]

    # 获取世界观模块（未指定类型时获取全部）
    if module_types:
        query = select(WorldModule).where(
            WorldModule.project_id == project_id,
            WorldModule.module_type.in_(module_types)
        )
    else:
        query = select(WorldModule).where(WorldModule.project_id == project_id)
    result = await db.execute(query)
    modules = result.scalars().all()
    if modules:
        parts.append("## 世界观设定\n")
        type_names = {
            "era": "时代背景", "geography": "地理环境", "magic": "魔法/科技体系",
            "politics": "政治体系", "race": "种族设定", "religion": "宗教信仰",
            "history": "历史事件", "culture": "社会文化", "economy": "经济体系"
        }
        for m in modules:
            label = type_names.get(m.module_type, m.module_type)
            parts.append(f"### {label} - {m.title}\n{m.content}\n")

    rules_result = await db.execute(
        select(WorldRule).where(WorldRule.project_id == project_id).order_by(WorldRule.priority.desc())
    )
    rules = rules_result.scalars().all()
    if rules:
        parts.append("## 硬规则（必须遵守）\n")
        for r in rules:
            parts.append(f"- {r.content}")
        parts.append("")

    # 获取角色（未指定 ID 时获取全部）
    if character_ids:
        chars_query = select(Character).where(
            Character.project_id == project_id,
            Character.id.in_(character_ids)
        )
    else:
        chars_query = select(Character).where(Character.project_id == project_id)
    chars_result = await db.execute(chars_query)
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
        if character_ids:
            rels_query = select(CharacterRelationship).where(
                CharacterRelationship.project_id == project_id,
                CharacterRelationship.from_char_id.in_(character_ids),
                CharacterRelationship.to_char_id.in_(character_ids)
            )
        else:
            rels_query = select(CharacterRelationship).where(CharacterRelationship.project_id == project_id)
        rels_result = await db.execute(rels_query)
        rels = rels_result.scalars().all()
        if rels:
            parts.append("### 角色关系")
            for r in rels:
                from_name = char_map.get(r.from_char_id, "?")
                to_name = char_map.get(r.to_char_id, "?")
                parts.append(f"- {from_name} → {to_name}: {r.relation_type} (亲密度: {r.intimacy})")
                if r.description:
                    parts.append(f"  {r.description}")
            parts.append("")

    return "\n".join(parts)


class BrowserWorker:
    """Runs Playwright in a dedicated thread with its own ProactorEventLoop."""

    def __init__(self):
        self.pw = None
        self.browser = None
        self.context = None
        self.page = None
        self.ready = False
        self.error = None

    def _run(self):
        import sys
        import asyncio
        if sys.platform == "win32":
            loop = asyncio.ProactorEventLoop()
            asyncio.set_event_loop(loop)

        from playwright.sync_api import sync_playwright
        try:
            logger.info("Starting Playwright...")
            self.pw = sync_playwright().start()
            logger.info("Launching Chrome (headless=False, channel=chrome)...")
            self.browser = self.pw.chromium.launch(
                headless=False,
                channel="chrome",
                args=["--disable-blink-features=AutomationControlled"]
            )
            logger.info("Creating context...")
            self.context = self.browser.new_context(
                viewport={"width": 1280, "height": 800},
                no_viewport=True,
            )
            self.page = self.context.new_page()
            logger.info("Navigating to DeepSeek...")
            self.page.goto("https://chat.deepseek.com/", timeout=60000)
            logger.info(f"Page loaded: {self.page.title()}")
            self.ready = True
        except Exception as e:
            logger.error(f"Browser worker error: {e}")
            import traceback
            logger.error(traceback.format_exc())
            self.error = str(e)

    def screenshot(self):
        if self.page:
            return self.page.screenshot(type="png")
        return None

    def check_login(self):
        if not self.page:
            return False
        try:
            url = self.page.url
            title = self.page.title()
            logger.info(f"check_login: url={url}, title={title}")

            # If URL changed from login page, user likely logged in
            if "/chat" in url or "new" in url.lower():
                logger.info("Detected login via URL change")
                return True

            # Check for chat input area (textarea or contenteditable div)
            textarea = self.page.query_selector("textarea")
            chat_input = self.page.query_selector('[contenteditable="true"]')
            input_area = self.page.query_selector('#chat-input')

            # Check for login/QR elements
            qr = self.page.query_selector('[class*="qrcode"]')
            login_modal = self.page.query_selector('[class*="login"]')
            scan_btn = self.page.query_selector('[class*="scan"]')

            has_input = textarea or chat_input or input_area
            has_login_ui = qr or login_modal or scan_btn

            logger.info(f"has_input={bool(has_input)}, has_login_ui={bool(has_login_ui)}")

            # If we see input and no login UI, we're logged in
            if has_input and not has_login_ui:
                return True

            # If no login UI at all, probably logged in
            if not has_login_ui and has_input:
                return True

            return False
        except Exception as e:
            logger.error(f"check_login error: {e}")
            return False

    def fill_input(self, text):
        if not self.page:
            return False
        try:
            el = self.page.wait_for_selector("textarea", timeout=5000)
            if el:
                el.click()
                el.fill(text)
                return True
        except:
            pass
        return False

    def send_message(self):
        if not self.page:
            return
        try:
            btn = self.page.query_selector('[class*="send"]') or \
                  self.page.query_selector('button[aria-label*="send"]') or \
                  self.page.query_selector('button[type="submit"]')
            if btn:
                btn.click()
            else:
                self.page.keyboard.press("Enter")
        except:
            pass

    def get_last_response(self):
        if not self.page:
            return ""
        try:
            blocks = self.page.query_selector_all('[class*="message"]') or \
                     self.page.query_selector_all('[class*="markdown"]') or \
                     self.page.query_selector_all('[class*="response"]')
            if blocks:
                return blocks[-1].inner_text()
        except:
            pass
        return ""

    def close(self):
        try:
            if self.browser:
                self.browser.close()
            if self.pw:
                self.pw.stop()
        except:
            pass


@router.post("/start")
async def start_browser(current_user: User = Depends(get_current_user)):
    logger.info("start_browser called!")
    session_id = str(uuid.uuid4())[:8]

    # Step 1: Test basic response
    logger.info(f"[{session_id}] Creating browser worker...")

    try:
        worker = BrowserWorker()
    except Exception as e:
        logger.error(f"Worker creation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Worker creation failed: {str(e)}")

    logger.info(f"[{session_id}] Starting thread...")
    thread = threading.Thread(target=worker._run, daemon=True)
    thread.start()

    logger.info(f"[{session_id}] Waiting for browser...")
    for i in range(90):
        await asyncio.sleep(0.5)
        if worker.ready or worker.error:
            break

    if worker.error:
        logger.error(f"[{session_id}] Browser failed: {worker.error}")
        raise HTTPException(status_code=500, detail=f"Browser failed: {worker.error}")

    if not worker.ready:
        logger.error(f"[{session_id}] Browser timeout")
        raise HTTPException(status_code=500, detail="Browser startup timeout")

    logger.info(f"[{session_id}] Browser ready!")

    _sessions[session_id] = {
        "worker": worker,
        "logged_in": False,
        "last_response": "",
    }
    return {"session_id": session_id, "status": "ok"}


@router.get("/qr/{session_id}")
async def get_qr(session_id: str, current_user: User = Depends(get_current_user)):
    session = _sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    worker = session["worker"]
    screenshot = await asyncio.to_thread(worker.screenshot)
    if not screenshot:
        raise HTTPException(status_code=500, detail="Failed to take screenshot")

    b64 = base64.b64encode(screenshot).decode()
    return {"image": f"data:image/png;base64,{b64}", "logged_in": session["logged_in"]}


@router.get("/status/{session_id}")
async def check_status(session_id: str, current_user: User = Depends(get_current_user)):
    session = _sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    worker = session["worker"]
    logged_in = await asyncio.to_thread(worker.check_login)
    if logged_in:
        session["logged_in"] = True
        return {"logged_in": True}

    # Take screenshot and get page info for debugging
    def _get_info():
        info = {}
        try:
            info["url"] = worker.page.url if worker.page else ""
            info["title"] = worker.page.title() if worker.page else ""
        except:
            pass
        return info

    page_info = await asyncio.to_thread(_get_info)
    screenshot = await asyncio.to_thread(worker.screenshot)
    result = {"logged_in": False, "page_info": page_info}
    if screenshot:
        result["image"] = f"data:image/png;base64,{base64.b64encode(screenshot).decode()}"
    return result


@router.post("/inject/{session_id}", response_model=InjectResponse)
async def inject_context(
    session_id: str, req: InjectRequest,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)
):
    session = _sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if not session["logged_in"]:
        raise HTTPException(status_code=400, detail="Not logged in yet")

    system_prompt = await _build_context_prompt(
        req.project_id, req.character_ids, req.module_types, db
    )
    if req.prompt:
        system_prompt += f"\n\n{req.prompt}"

    worker = session["worker"]
    ok = await asyncio.to_thread(worker.fill_input, system_prompt)
    if ok:
        return InjectResponse(system_prompt=system_prompt, status="injected")

    raise HTTPException(status_code=500, detail="Could not find input element")


@router.post("/send/{session_id}")
async def send_message(session_id: str, current_user: User = Depends(get_current_user)):
    session = _sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    worker = session["worker"]
    await asyncio.to_thread(worker.send_message)
    return {"status": "sent"}


@router.get("/response/{session_id}")
async def get_response(session_id: str, current_user: User = Depends(get_current_user)):
    session = _sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    worker = session["worker"]
    text = await asyncio.to_thread(worker.get_last_response)
    new = text != session.get("last_response", "")
    session["last_response"] = text
    return {"response": text, "is_new": new}


class ChatRequest(BaseModel):
    messages: list[dict]
    temperature: float = 0.7
    max_tokens: int = 4096
    model: str = "deepseek"
    project_id: str = ""
    include_context: bool = False
    is_continue: bool = False


# 可选认证：没有 token 时使用匿名用户
async def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = None,
    db: AsyncSession = Depends(get_db)
) -> Optional[User]:
    if not credentials:
        return None
    try:
        from app.utils.auth import decode_token
        payload = decode_token(credentials.credentials)
        if not payload or payload.get("type") != "access":
            return None
        result = await db.execute(select(User).where(User.id == payload["sub"]))
        user = result.scalar_one_or_none()
        if user and user.is_active:
            return user
    except Exception:
        pass
    return None


class SyncCookieRequest(BaseModel):
    cookie: str


@router.post("/sync-cookie")
async def sync_cookie(req: SyncCookieRequest):
    """从浏览器扩展同步 cookie 到内存中"""
    _cookie_store["cookie"] = req.cookie
    logger.info(f"Cookie synced! length={len(req.cookie)}")
    return {"status": "ok", "length": len(req.cookie)}


@router.get("/cookie-status")
async def cookie_status():
    """检查 cookie 是否已同步"""
    return {
        "has_cookie": bool(_cookie_store["cookie"]),
        "length": len(_cookie_store["cookie"]) if _cookie_store["cookie"] else 0
    }


@router.post("/test")
async def test_connection(current_user: User = Depends(get_current_user)):
    """测试与 DeepSeek 的连接是否正常"""
    settings = get_settings()
    cookie = _cookie_store["cookie"] or settings.DEEPSEEK_COOKIE
    api_url = settings.DEEPSEEK_WEB_API_URL or "https://chat.deepseek.com/api/v0/chat/completions"

    result = {
        "cookie_length": len(cookie) if cookie else 0,
        "has_cookie": bool(cookie),
        "api_url": api_url,
        "test_result": None,
        "error": None
    }

    if not cookie:
        result["error"] = "未配置 Cookie"
        return result

    async with httpx.AsyncClient() as client:
        try:
            headers = {
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0",
                "Cookie": cookie,
                "Origin": "https://chat.deepseek.com",
                "Referer": "https://chat.deepseek.com/",
            }
            test_resp = await client.get(
                "https://chat.deepseek.com/api/v0/models",
                headers=headers,
                timeout=10.0
            )
            result["test_result"] = {
                "status": test_resp.status_code,
                "body": test_resp.text[:200]
            }
        except Exception as e:
            result["error"] = str(e)

    return result


@router.post("/chat")
async def proxy_chat(
    req: ChatRequest,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(HTTPBearer(auto_error=False))
):
    """
    反向代理到 DeepSeek 免费网页版的聊天 API。
    优先使用从浏览器同步的 cookie，其次使用 .env 中的 DEEPSEEK_COOKIE。
    支持可选认证：没有 token 时使用匿名用户 ID。
    """
    settings = get_settings()
    cookie = _cookie_store["cookie"] or settings.DEEPSEEK_COOKIE
    if not cookie:
        raise HTTPException(
            status_code=400,
            detail="未配置 DEEPSEEK_COOKIE"
        )

    # 获取用户 ID（支持匿名）
    if credentials:
        try:
            from app.utils.auth import decode_token
            payload = decode_token(credentials.credentials)
            user_id = payload.get("sub", "anonymous") if payload else "anonymous"
        except Exception:
            user_id = "anonymous"
    else:
        user_id = "anonymous"

    # 频率限制：每个用户至少间隔 _REQUEST_COOLDOWN 秒
    now = time.time()
    last_time = _last_request_time.get(user_id, 0)
    elapsed = now - last_time
    if elapsed < _REQUEST_COOLDOWN:
        wait_remaining = int(_REQUEST_COOLDOWN - elapsed) + 1
        raise HTTPException(
            status_code=429,
            detail=f"请求过于频繁，请等待 {wait_remaining} 秒后再试"
        )
    _last_request_time[user_id] = now

    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
        "Accept": "text/event-stream",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Cookie": cookie,
        "Origin": "https://chat.deepseek.com",
        "Referer": "https://chat.deepseek.com/",
        "X-Requested-With": "XMLHttpRequest",
    }

    api_url = settings.DEEPSEEK_WEB_API_URL or "https://chat.deepseek.com/api/v0/chat/completions"

    payload = {
        "model": "deepseek",
        "messages": req.messages,
        "stream": True
    }

    async def generate():
        for attempt in range(_MAX_RETRIES + 1):
            async with httpx.AsyncClient() as client:
                try:
                    if attempt > 0:
                        logger.info(f"[Proxy] Retry #{attempt} for user {user_id}")

                    logger.info(f"[Proxy] POST {api_url} with {len(req.messages)} messages (attempt {attempt + 1})")

                    async with client.stream(
                        "POST",
                        api_url,
                        json=payload,
                        headers=headers,
                        timeout=120.0
                    ) as response:
                        logger.info(f"[Proxy] Response status: {response.status_code}")

                        if response.status_code == 401:
                            yield f"data: {json.dumps({'error': 'Cookie 已过期，请在 chat.deepseek.com 重新登录'})}\n\n"
                            return

                        if response.status_code == 429:
                            retry_after_str = response.headers.get("Retry-After", "60")
                            try:
                                retry_after = int(retry_after_str)
                            except (ValueError, TypeError):
                                retry_after = 60
                            # 限制最大等待时间
                            retry_after = min(retry_after, 120)

                            if attempt < _MAX_RETRIES:
                                logger.info(f"[Proxy] Got 429, auto-retry in {retry_after}s (attempt {attempt + 1}/{_MAX_RETRIES + 1})")
                                # 通知前端正在重试
                                yield f"data: {json.dumps({'type': 'retrying', 'message': f'DeepSeek 限流，{retry_after}秒后自动重试...', 'wait': retry_after})}\n\n"
                                await asyncio.sleep(retry_after)
                                # 更新冷却时间
                                _last_request_time[user_id] = time.time()
                                continue  # 重试
                            else:
                                yield f"data: {json.dumps({'error': f'DeepSeek 持续限流（已重试{_MAX_RETRIES}次），请等待 {retry_after} 秒后手动重试', 'code': 429, 'retry_after': retry_after})}\n\n"
                                return

                        if response.status_code != 200:
                            error_body = await response.aread()
                            err_text = error_body.decode(errors='ignore')[:500]
                            logger.error(f"[Proxy] Error {response.status_code}: {err_text}")
                            yield f"data: {json.dumps({'error': f'DeepSeek 返回 {response.status_code}', 'detail': err_text})}\n\n"
                            return

                        # 成功，流式读取（用 aiter_bytes 避免 httpx 文本缓冲）
                        buffer = ""
                        async for raw_chunk in response.aiter_bytes():
                            text = raw_chunk.decode("utf-8", errors="ignore")
                            buffer += text
                            while "\n" in buffer:
                                line, buffer = buffer.split("\n", 1)
                                line = line.strip()
                                if line.startswith("data: "):
                                    data_str = line[6:]
                                    if data_str == "[DONE]":
                                        break
                                    try:
                                        data = json.loads(data_str)
                                        choices = data.get("choices", [{}])
                                        if choices and choices[0]:
                                            delta = choices[0].get("delta", {})
                                            content = delta.get("content", "")
                                            if content:
                                                yield f"data: {json.dumps({'content': content})}\n\n"
                                    except json.JSONDecodeError:
                                        continue
                        yield "data: [DONE]\n\n"
                        return  # 成功，退出重试循环

                except httpx.ConnectError as e:
                    logger.error(f"[Proxy] ConnectError: {e}")
                    yield f"data: {json.dumps({'error': '无法连接到 chat.deepseek.com，请检查网络'})}\n\n"
                    return
                except Exception as e:
                    logger.error(f"[Proxy] Error: {e}", exc_info=True)
                    if attempt < _MAX_RETRIES:
                        logger.info(f"[Proxy] Exception, retrying in 10s...")
                        await asyncio.sleep(10)
                        continue
                    yield f"data: {json.dumps({'error': f'代理错误: {str(e)}'})}\n\n"
                    return

    return StreamingResponse(generate(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no"
    })




@router.post("/extension-chat")
async def extension_chat(
    req: ChatRequest,
    db: AsyncSession = Depends(get_db),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(HTTPBearer(auto_error=False))
):
    """
    通过浏览器扩展发起 DeepSeek 同源聊天。
    创建待处理任务 → 扩展获取 → content script 操作 DS 页面。
    如果有 project_id，自动编译项目数据为 TXT 上传到 DS 作为上下文。
    支持可选认证：没有 token 时使用匿名用户 ID。
    """
    # 获取用户 ID（支持匿名）
    if credentials:
        try:
            from app.utils.auth import decode_token
            payload = decode_token(credentials.credentials)
            user_id = payload.get("sub", "anonymous") if payload else "anonymous"
        except Exception:
            user_id = "anonymous"
    else:
        user_id = "anonymous"

    task_id = str(uuid.uuid4())[:12]
    queue: asyncio.Queue = asyncio.Queue()

    # 编译项目上下文 TXT（仅当用户勾选了"附带项目设定"）
    context_txt = ""
    if req.project_id and req.include_context:
        try:
            context_txt = await _build_context_prompt(
                req.project_id, [], [], db
            )
            logger.info(f"[NF_BE] Step 1: Compiled context TXT for project {req.project_id}, length={len(context_txt)}")
        except Exception as e:
            logger.warning(f"[NF_BE] Step 1: Failed to compile context: {e}")

    _chat_tasks[task_id] = {
        "user_id": user_id,
        "messages": req.messages,
        "temperature": req.temperature,
        "context_txt": context_txt,
        "is_continue": req.is_continue,
        "status": "pending",
        "queue": queue,
        "created_at": time.time()
    }
    logger.info(f"[NF_BE] Step 1: Created task {task_id} for user {user_id}, status=pending, is_continue={req.is_continue}, messages_count={len(req.messages)}, context_len={len(context_txt)}")

    _KEEPALIVE_INTERVAL = 15
    _TOTAL_TIMEOUT = 300
    _DONE_GRACE_PERIOD = 1  # 收到 done 后等待 1 秒（拦截器已确认流结束，grace 只做最小缓冲）

    async def event_stream():
        start_time = time.time()
        chunk_count = 0
        try:
            yield f"data: {json.dumps({'type': 'waiting', 'task_id': task_id, 'message': '等待 DeepSeek 页面响应...'})}\n\n"

            while True:
                elapsed = time.time() - start_time
                if elapsed > _TOTAL_TIMEOUT:
                    logger.warning(f"[NF_BE_SSE] Task {task_id} TIMEOUT after {elapsed:.0f}s")
                    yield f"data: {json.dumps({'error': f'任务超时（{_TOTAL_TIMEOUT}秒）'})}\n\n"
                    break

                try:
                    item = await asyncio.wait_for(queue.get(), timeout=_KEEPALIVE_INTERVAL)
                    chunk_count += 1
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
                    continue

                item_type = item.get("type", "?")
                logger.info(f"[NF_BE_SSE] Task {task_id} got item #{chunk_count}: type={item_type}, queue_size={queue.qsize()}")

                if item["type"] == "chunk":
                    chunk_data = {'content': item['content']}
                    if item.get('filtered'):
                        chunk_data['filtered'] = True
                    yield f"data: {json.dumps(chunk_data)}\n\n"
                elif item["type"] == "picked_up":
                    logger.info(f"[NF_BE_SSE] Task {task_id} picked up")
                    yield f"data: {json.dumps({'type': 'picked_up', 'message': '已转发到 DeepSeek 页面'})}\n\n"
                elif item["type"] == "done":
                    logger.info(f"[NF_BE_SSE] Task {task_id} DONE received, entering {_DONE_GRACE_PERIOD}s grace period")
                    grace_start = time.time()
                    got_more = False
                    should_continue = False
                    while time.time() - grace_start < _DONE_GRACE_PERIOD:
                        try:
                            next_item = await asyncio.wait_for(queue.get(), timeout=2)
                            chunk_count += 1
                            next_type = next_item.get("type", "?")
                            logger.info(f"[NF_BE_SSE] Task {task_id} grace got: type={next_type}")
                            if next_item["type"] == "chunk":
                                got_more = True
                                chunk_data = {'content': next_item['content']}
                                if next_item.get('filtered'):
                                    chunk_data['filtered'] = True
                                yield f"data: {json.dumps(chunk_data)}\n\n"
                                grace_start = time.time()
                            elif next_item["type"] == "done":
                                grace_start = time.time()
                            elif next_item["type"] == "ds_state":
                                yield f"data: {json.dumps({'type': 'ds_state', 'state': next_item['state']})}\n\n"
                                if next_item["state"] == "continue":
                                    logger.info(f"[NF_BE_SSE] Task {task_id} grace: DS continue → back to main loop")
                                    should_continue = True
                                    break
                            elif next_item["type"] == "error":
                                yield f"data: {json.dumps({'error': next_item['error']})}\n\n"
                                return
                        except asyncio.TimeoutError:
                            yield ": keepalive\n\n"
                            continue
                    if should_continue:
                        continue
                    logger.info(f"[NF_BE_SSE] Task {task_id} grace ended, got_more={got_more}")
                    yield "data: [DONE]\n\n"
                    break
                elif item["type"] == "error":
                    logger.error(f"[NF_BE_SSE] Task {task_id} error: {item['error']}")
                    yield f"data: {json.dumps({'error': item['error']})}\n\n"
                    break
                elif item["type"] == "ds_state":
                    logger.info(f"[NF_BE_SSE] Task {task_id} forwarding ds_state={item['state']}")
                    yield f"data: {json.dumps({'type': 'ds_state', 'state': item['state']})}\n\n"
        except Exception as e:
            logger.error(f"[NF_BE_SSE] Task {task_id} stream EXCEPTION: {e}", exc_info=True)
            yield f"data: {json.dumps({'error': f'流处理异常: {str(e)}'})}\n\n"
        finally:
            _chat_tasks.pop(task_id, None)
            logger.info(f"[NF_BE_SSE] Task {task_id} CLEANED UP, total_chunks={chunk_count}")

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/extension-chat/poll")
async def poll_tasks(current_user: User = Depends(get_current_user)):
    """轮询接口：扩展定期检查是否有待处理任务（SSE 流的兜底方案）"""
    user_id = str(current_user.id)
    for task_id, task in list(_chat_tasks.items()):
        if task["user_id"] == user_id and task["status"] == "pending":
            task["status"] = "processing"
            logger.info(f"[NF_BE] Poll: Extension picked up task {task_id}")
            await task["queue"].put({"type": "picked_up", "content": ""})
            return {
                "task_id": task_id,
                "messages": task["messages"],
                "temperature": task["temperature"],
                "context_txt": task.get("context_txt", ""),
                "is_continue": task.get("is_continue", False)
            }
    return {"task_id": None}


@router.get("/extension-chat/stream")
async def extension_task_stream(current_user: User = Depends(get_current_user)):
    """SSE 流：后端有任务时主动推送给扩展，零轮询"""
    user_id = str(current_user.id)

    # 记录扩展连接（每次生成唯一连接 ID，防止旧 finally 块干扰新连接）
    now = time.time()
    conn_id = str(uuid.uuid4())[:8]
    _extension_connections[user_id] = {"connected_at": now, "last_heartbeat": now, "conn_id": conn_id}
    logger.info(f"[NF_BE] Extension SSE connected for user {user_id}, conn_id={conn_id}")

    # 通知前端 WS 客户端：扩展已上线
    await _broadcast_to_ws(user_id, {"type": "extension_status", "connected": True})

    async def event_stream():
        keepalive_count = 0
        try:
            while True:
                # 更新心跳（仅当此连接仍是活跃连接时）
                if _extension_connections.get(user_id, {}).get("conn_id") == conn_id:
                    _extension_connections[user_id]["last_heartbeat"] = time.time()

                pending_tasks = [tid for tid, t in _chat_tasks.items() if t["user_id"] == user_id and t["status"] == "pending"]
                if pending_tasks:
                    logger.info(f"[NF_BE] Extension found pending tasks: {pending_tasks}")

                for task_id, task in list(_chat_tasks.items()):
                    if task["user_id"] == user_id and task["status"] == "pending":
                        task["status"] = "processing"
                        logger.info(f"[NF_BE] Step 3: Extension picked up task {task_id}, sending to extension")
                        await task["queue"].put({"type": "picked_up", "content": ""})
                        yield f"data: {json.dumps({'task_id': task_id, 'messages': task['messages'], 'temperature': task['temperature'], 'context_txt': task.get('context_txt', '')})}\n\n"
                        logger.info(f"[NF_BE] Step 3: Task {task_id} sent to extension, SSE stream returning")
                        return
                await asyncio.sleep(0.5)
                keepalive_count += 1
                if keepalive_count % 20 == 0:  # 每 10 秒打印一次
                    logger.debug(f"[NF_BE] Extension SSE keepalive #{keepalive_count} for user {user_id}")
                yield ": keepalive\n\n"
        except Exception as e:
            logger.error(f"[NF_BE] Extension SSE stream error for user {user_id}: {e}", exc_info=True)
        finally:
            # 仅当此连接仍是活跃连接时才移除追踪（防止旧连接的 finally 干扰新连接）
            if _extension_connections.get(user_id, {}).get("conn_id") == conn_id:
                _extension_connections.pop(user_id, None)
                logger.info(f"[NF_BE] Extension SSE closed for user {user_id}, conn_id={conn_id}, keepalive_count={keepalive_count}")
                # 通知前端 WS 客户端：扩展已下线
                await _broadcast_to_ws(user_id, {"type": "extension_status", "connected": False})
            else:
                logger.info(f"[NF_BE] Extension conn_id={conn_id} closed but newer connection exists, skipping disconnect broadcast")

    return StreamingResponse(event_stream(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no"
    })


@router.get("/extension-status")
async def extension_status(current_user: User = Depends(get_current_user)):
    """检查扩展是否已连接 SSE"""
    user_id = str(current_user.id)
    conn = _extension_connections.get(user_id)

    if not conn:
        return {"connected": False, "message": "扩展未连接"}

    elapsed = time.time() - conn["last_heartbeat"]
    if elapsed > _EXTENSION_TIMEOUT:
        _extension_connections.pop(user_id, None)
        return {"connected": False, "message": "扩展连接已超时"}

    return {"connected": True, "message": "扩展已就绪", "connected_seconds": int(time.time() - conn["connected_at"])}


@router.post("/extension-heartbeat")
async def extension_heartbeat(current_user: User = Depends(get_current_user)):
    """扩展心跳检测"""
    user_id = str(current_user.id)
    was_connected = bool(_extension_connections.get(user_id))
    _extension_connections[user_id] = {
        "connected_at": _extension_connections.get(user_id, {}).get("connected_at", time.time()),
        "last_heartbeat": time.time(),
        "conn_id": _extension_connections.get(user_id, {}).get("conn_id", str(uuid.uuid4())[:8])
    }
    # 如果之前断开过，广播恢复状态给前端
    if not was_connected:
        await _broadcast_to_ws(user_id, {"type": "extension_status", "connected": True})
    return {"ok": True}


@router.websocket("/ws/ai-assistant")
async def ws_ai_assistant(websocket: WebSocket):
    """WebSocket 端点：前端实时接收扩展状态 + 任务事件推送"""
    from app.database import async_session
    from app.utils.auth import decode_token

    token = websocket.query_params.get("token")
    if not token:
        logger.info("[NF_WS] Rejected: missing token")
        await websocket.close(code=4001, reason="Missing token")
        return

    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        logger.info(f"[NF_WS] Rejected: invalid token, payload_type={payload.get('type') if payload else None}")
        await websocket.close(code=4001, reason="Invalid token")
        return

    user_id = payload["sub"]
    logger.info(f"[NF_WS] Token valid, user_id={user_id}")

    # 验证用户存在
    try:
        async with async_session() as session:
            result = await session.execute(select(User).where(User.id == user_id))
            user = result.scalar_one_or_none()
            if not user or not user.is_active:
                logger.info(f"[NF_WS] Rejected: user not found or inactive, user_id={user_id}")
                await websocket.close(code=4001, reason="User not found")
                return
    except Exception as e:
        logger.warning(f"[NF_WS] Rejected: auth error: {e}")
        await websocket.close(code=4001, reason="Auth error")
        return

    await websocket.accept()
    logger.info(f"[NF_WS] Client connected: user_id={user_id}")

    # 追踪 WS 连接
    if user_id not in _ws_clients:
        _ws_clients[user_id] = set()
    _ws_clients[user_id].add(websocket)
    logger.info(f"[NF_WS] Total WS clients for user {user_id}: {len(_ws_clients[user_id])}")

    try:
        # 发送当前扩展状态
        is_ext_connected = False
        conn = _extension_connections.get(user_id)
        if conn:
            elapsed = time.time() - conn["last_heartbeat"]
            is_ext_connected = elapsed <= _EXTENSION_TIMEOUT

        logger.info(f"[NF_WS] Sending initial status to user {user_id}: connected={is_ext_connected}, ext_conn={conn is not None}, elapsed={elapsed:.1f}s" if conn else f"[NF_WS] Sending initial status to user {user_id}: connected=False, no ext_conn")
        await websocket.send_json({
            "type": "extension_status",
            "connected": is_ext_connected
        })

        # 保持连接，接收客户端心跳
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=25)
                if data == "ping":
                    await websocket.send_text("pong")
                elif data == "recheck":
                    # 前端请求重新检查扩展连接状态
                    conn = _extension_connections.get(user_id)
                    is_connected = False
                    if conn:
                        elapsed = time.time() - conn["last_heartbeat"]
                        if elapsed <= _EXTENSION_TIMEOUT:
                            is_connected = True
                        else:
                            _extension_connections.pop(user_id, None)
                    await websocket.send_json({"type": "extension_status", "connected": is_connected})
            except asyncio.TimeoutError:
                # 发送 keepalive + 扩展状态（定期推送，防止前端状态过期）
                conn = _extension_connections.get(user_id)
                is_connected = False
                if conn:
                    elapsed = time.time() - conn["last_heartbeat"]
                    if elapsed <= _EXTENSION_TIMEOUT:
                        is_connected = True
                    else:
                        _extension_connections.pop(user_id, None)
                try:
                    await websocket.send_json({"type": "keepalive"})
                    await websocket.send_json({"type": "extension_status", "connected": is_connected})
                except Exception:
                    logger.info(f"[NF_WS] Keepalive send failed for user {user_id}, breaking")
                    break
    except WebSocketDisconnect:
        logger.info(f"[NF_WS] Client disconnected (WebSocketDisconnect): user_id={user_id}")
    except Exception as e:
        logger.warning(f"[NF_WS] Client error: user_id={user_id}, error={e}")
    finally:
        if user_id in _ws_clients:
            _ws_clients[user_id].discard(websocket)
            if not _ws_clients[user_id]:
                del _ws_clients[user_id]
                logger.info(f"[NF_WS] Removed WS client set for user {user_id}")
            else:
                logger.info(f"[NF_WS] Remaining WS clients for user {user_id}: {len(_ws_clients[user_id])}")
        logger.info(f"[NF_WS] Client disconnected: user_id={user_id}")


class ChunkRequest(BaseModel):
    content: str = ""
    filtered: bool = False


class ErrorRequest(BaseModel):
    error: str


@router.post("/extension-chat/{task_id}/chunk")
async def push_chunk(task_id: str, req: ChunkRequest, current_user: User = Depends(get_current_user)):
    task = _chat_tasks.get(task_id)
    if not task or task["user_id"] != str(current_user.id):
        logger.warning(f"[NF_BE] push_chunk: task {task_id} NOT FOUND, active_tasks={list(_chat_tasks.keys())}")
        raise HTTPException(status_code=404, detail="Task not found")
    # 过滤 DS token 超限时的 INCOMPLETE 标记
    content = req.content
    if content and content.rstrip().endswith("INCOMPLETE"):
        content = content.rstrip()
        content = content[:-len("INCOMPLETE")].rstrip()
        logger.info(f"[NF_BE] push_chunk: stripped INCOMPLETE, new_len={len(content)}")
    if content:
        logger.info(f"[NF_BE] push_chunk: task {task_id}, content_len={len(content)}, queue_size={task['queue'].qsize()}")
        await task["queue"].put({"type": "chunk", "content": content, "filtered": req.filtered})
    else:
        logger.info(f"[NF_BE] push_chunk: task {task_id}, content empty after strip, skipping")
    return {"ok": True}


@router.post("/extension-chat/{task_id}/done")
async def push_done(task_id: str, current_user: User = Depends(get_current_user)):
    task = _chat_tasks.get(task_id)
    if not task or task["user_id"] != str(current_user.id):
        logger.warning(f"[NF_BE] push_done: task {task_id} NOT FOUND, active_tasks={list(_chat_tasks.keys())}")
        raise HTTPException(status_code=404, detail="Task not found")
    task["status"] = "done"
    logger.info(f"[NF_BE] push_done: task {task_id}, queue_size={task['queue'].qsize()}")
    await task["queue"].put({"type": "done"})
    return {"ok": True}


@router.post("/extension-chat/{task_id}/state")
async def push_ds_state(task_id: str, req: dict, current_user: User = Depends(get_current_user)):
    state = req.get("state", "idle")
    _ds_states[task_id] = state
    logger.info(f"[NF_BE] DS state for task {task_id}: {state}")
    # 将状态推入 queue，让 event_stream 能转发给前端
    task = _chat_tasks.get(task_id)
    if task and task["user_id"] == str(current_user.id):
        await task["queue"].put({"type": "ds_state", "state": state})
        logger.info(f"[NF_BE] DS state pushed to queue for task {task_id}: {state}")
    else:
        logger.warning(f"[NF_BE] DS state: task {task_id} not found in _chat_tasks, cannot push to queue")
    return {"ok": True}


@router.get("/extension-chat/{task_id}/state")
async def get_ds_state(task_id: str, current_user: User = Depends(get_current_user)):
    state = _ds_states.get(task_id, "idle")
    return {"state": state}


@router.post("/extension-chat/{task_id}/action")
async def ds_action(task_id: str, req: dict, current_user: User = Depends(get_current_user)):
    task = _chat_tasks.get(task_id)
    if not task or task["user_id"] != str(current_user.id):
        raise HTTPException(status_code=404, detail="Task not found")
    action = req.get("action", "")
    logger.info(f"[NF_BE] DS action for task {task_id}: {action}")
    task["pending_action"] = action
    return {"ok": True}


@router.get("/extension-chat/{task_id}/action")
async def get_ds_action(task_id: str, current_user: User = Depends(get_current_user)):
    task = _chat_tasks.get(task_id)
    if not task or task["user_id"] != str(current_user.id):
        raise HTTPException(status_code=404, detail="Task not found")
    action = task.pop("pending_action", None)
    return {"action": action}


@router.post("/extension-chat/{task_id}/error")
async def push_error(task_id: str, req: ErrorRequest, current_user: User = Depends(get_current_user)):
    task = _chat_tasks.get(task_id)
    if not task or task["user_id"] != str(current_user.id):
        logger.warning(f"[NF_BE] Step 5: error for task {task_id} failed: task not found or user mismatch")
        raise HTTPException(status_code=404, detail="Task not found")
    task["status"] = "error"
    logger.error(f"[NF_BE] Step 5: error for task {task_id}: {req.error}")
    await task["queue"].put({"type": "error", "error": req.error})
    return {"ok": True}


@router.post("/stop/{session_id}")
async def stop_browser(session_id: str, current_user: User = Depends(get_current_user)):
    session = _sessions.pop(session_id, None)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    worker = session["worker"]
    await asyncio.to_thread(worker.close)
    return {"status": "stopped"}
