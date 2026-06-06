@echo off
title NovelForge - Starting...

echo ========================================
echo   NovelForge - AI Novel Workshop
echo ========================================
echo.

echo [1/2] Starting FastAPI backend (port 8000)...
start "NF-Backend" cmd /k "cd /d %~dp0backend && call .venv\Scripts\activate && python -m uvicorn app.main:app --host 0.0.0.0 --port 9000 --reload"

timeout /t 3 /nobreak >nul

echo [2/2] Starting Vue frontend (port 5200)...
start "NF-Frontend" cmd /k "cd /d %~dp0web-frontend && npm run dev -- --port 5200"

timeout /t 5 /nobreak >nul

echo.
echo ========================================
echo   All services started!
echo   Frontend:  http://localhost:5200
echo   Backend:   http://localhost:9000
echo   API Docs:  http://localhost:9000/docs
echo ========================================
echo.

start http://localhost:5200

pause
