import logging
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlmodel import select
from app.database import get_db
from app.models.user import User, UserSession
from app.utils.auth import hash_password, verify_password, create_access_token, create_refresh_token, decode_token

logger = logging.getLogger("auth")
router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
security = HTTPBearer()


class RegisterRequest(BaseModel):
    email: EmailStr
    username: str
    password: str
    nickname: str = ""


class LoginRequest(BaseModel):
    account: str  # accepts email or username
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class UserResponse(BaseModel):
    id: str
    email: str
    username: str
    nickname: str
    avatar_url: str | None
    created_at: datetime


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == req.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    result = await db.execute(select(User).where(User.username == req.username))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Username already taken")

    user = User(
        email=req.email,
        username=req.username,
        password_hash=hash_password(req.password),
        nickname=req.nickname or req.username
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    access_token = create_access_token({"sub": user.id, "email": user.email})
    refresh_token = create_refresh_token({"sub": user.id, "email": user.email})

    session = UserSession(
        user_id=user.id,
        refresh_token=refresh_token,
        expires_at=datetime.utcnow() + timedelta(days=7)
    )
    db.add(session)
    await db.commit()

    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    logger.info(f"[LOGIN] Attempting login with account: {req.account}")
    result = await db.execute(
        select(User).where((User.email == req.account) | (User.username == req.account))
    )
    user = result.scalar_one_or_none()
    logger.info(f"[LOGIN] User found in DB: {user is not None}")
    if not user or not verify_password(req.password, user.password_hash):
        logger.warning(f"[LOGIN] Invalid credentials for account: {req.account}")
        raise HTTPException(status_code=401, detail="Invalid account or password")

    if not user.is_active:
        logger.warning(f"[LOGIN] Account deactivated: {req.account}")
        raise HTTPException(status_code=403, detail="Account is deactivated")

    access_token = create_access_token({"sub": user.id, "email": user.email})
    refresh_token = create_refresh_token({"sub": user.id, "email": user.email})
    logger.info(f"[LOGIN] Success! user_id={user.id}, username={user.username}")

    session = UserSession(
        user_id=user.id,
        refresh_token=refresh_token,
        expires_at=datetime.utcnow() + timedelta(days=7)
    )
    db.add(session)
    await db.commit()

    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(req: RefreshRequest, db: AsyncSession = Depends(get_db)):
    payload = decode_token(req.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    result = await db.execute(select(UserSession).where(UserSession.refresh_token == req.refresh_token))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=401, detail="Session not found")

    if session.expires_at < datetime.utcnow():
        await db.delete(session)
        await db.commit()
        raise HTTPException(status_code=401, detail="Refresh token expired")

    user_result = await db.execute(select(User).where(User.id == session.user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    new_access = create_access_token({"sub": user.id, "email": user.email})
    new_refresh = create_refresh_token({"sub": user.id, "email": user.email})

    session.refresh_token = new_refresh
    session.expires_at = datetime.utcnow() + timedelta(days=7)
    await db.commit()

    return TokenResponse(access_token=new_access, refresh_token=new_refresh)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db)
) -> User:
    logger.info(f"[GET_USER] Token received: {credentials.credentials[:50]}...")
    payload = decode_token(credentials.credentials)
    logger.info(f"[GET_USER] Payload decoded: {payload}")
    if not payload or payload.get("type") != "access":
        logger.warning(f"[GET_USER] Invalid token type or payload: payload={payload}")
        raise HTTPException(status_code=401, detail="Invalid access token")

    result = await db.execute(select(User).where(User.id == payload["sub"]))
    user = result.scalar_one_or_none()
    logger.info(f"[GET_USER] User from DB: {user is not None}, user_id={payload.get('sub')}")
    if not user or not user.is_active:
        logger.warning(f"[GET_USER] User not found or inactive")
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        username=current_user.username,
        nickname=current_user.nickname,
        avatar_url=current_user.avatar_url,
        created_at=current_user.created_at
    )
