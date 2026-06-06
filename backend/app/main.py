import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
# 降低 uvicorn access 日志频率（避免 404 轮询刷屏）
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import get_settings
from app.database import engine
from app.routers import health, auth, projects, chapters, generate, world, characters, free_mode, import_data

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: create tables
    from sqlmodel import SQLModel
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    yield
    # Shutdown
    await engine.dispose()


app = FastAPI(
    title="NovelForge API",
    description="AI-Powered Novel Creation Platform",
    version="0.1.0",
    lifespan=lifespan
)

@app.middleware("http")
async def log_requests(request, call_next):
    logger = logging.getLogger("novelforge")
    logger.info(f">>> {request.method} {request.url.path}")
    try:
        response = await call_next(request)
        if response.status_code == 404 and "extension-chat/pending" in request.url.path:
            logger.debug(f"<<< {request.method} {request.url.path} -> {response.status_code}")
        else:
            logger.info(f"<<< {request.method} {request.url.path} -> {response.status_code}")
        return response
    except Exception as e:
        logger.error(f"!!! {request.method} {request.url.path} -> ERROR: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(health.router)
app.include_router(auth.router)
app.include_router(projects.router)
app.include_router(chapters.router)
app.include_router(generate.router)
app.include_router(world.router)
app.include_router(characters.router)
app.include_router(free_mode.router)
app.include_router(import_data.router)


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    import traceback
    tb = traceback.format_exc()
    logging.getLogger("novelforge").error(f"UNHANDLED: {type(exc).__name__}: {exc}\n{tb}")
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=500, content={"detail": f"{type(exc).__name__}: {exc}"})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
