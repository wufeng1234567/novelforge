# NovelForge 开发任务进度

## 最后更新时间：2026-05-23 19:12

### 已完成
- [x] FastAPI 后端项目搭建 - 2026-05-23 19:08 - 项目结构、健康检查、数据库连接、SQLModel 模型
- [x] Flutter 前端项目搭建 - 2026-05-23 19:08 - 项目结构、Riverpod、GoRouter、主题配置
- [x] 用户认证模块 - 2026-05-23 19:12 - 注册/登录/JWT/令牌刷新/获取用户信息 (已测试通过)
- [x] 项目管理 CRUD - 2026-05-23 19:12 - 创建/编辑/删除/列表/搜索/排序/分页 (已测试通过)
- [x] 章节管理 - 2026-05-23 19:12 - 创建/编辑/删除/列表/版本历史 (已测试通过)
- [x] AI 流式生成 - 2026-05-23 19:08 - SSE 流式续写/大纲生成/改写/情节建议

### 进行中
- （暂无）

### 待开发（按优先级排序）
1. 章节管理前端界面 - P1
2. 世界观系统（9大模块、超凡等级） - P1
3. 角色系统（关系图谱） - P1
4. 向量检索与语义搜索 - P1
5. 多模型兼容系统 - P1
6. 版本历史与分支管理 - P2
7. 统计与费用控制 - P2
8. 免费使用方案（Web自动化） - P2
9. 辅助工具（灵感生成器、导出） - P2

### 遇到的问题
- Python 需要使用 `py` 命令而非 `python` 或 `python3`
- bcrypt 版本兼容性问题，需要降级到 4.0.1

### 下一步计划
- 完善 Flutter 前端页面（项目列表、编辑器、AI对话）
- 实现世界观系统后端和前端
- 实现角色系统后端和前端

### 技术栈
- **后端**: FastAPI + SQLModel + asyncpg + PostgreSQL (pgvector) + Redis
- **前端**: Flutter 3.41 + Riverpod + Dio + GoRouter + SharedPreferences
- **数据库**: PostgreSQL 16 (Docker, root/123456, port 5432)
- **缓存**: Redis Stack (Docker, port 6379)

### API 端点（已测试通过）
- 健康检查: `GET /health` ✓
- 认证: `/api/v1/auth/register`, `/api/v1/auth/login`, `/api/v1/auth/refresh`, `/api/v1/auth/me` ✓
- 项目: `/api/v1/projects` (CRUD) ✓
- 章节: `/api/v1/projects/{id}/chapters` (CRUD, 版本) ✓
- AI生成: `/api/v1/generate/stream`, `/api/v1/generate/outline`, `/api/v1/generate/rewrite`, `/api/v1/generate/suggestions`

### 启动命令
**后端:**
```bash
cd D:\novelforge\novelforge-app\backend
.venv\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

**前端:**
```bash
cd D:\novelforge\novelforge-app\frontend
flutter run -d windows  # Windows 桌面
flutter run -d android  # Android
```
