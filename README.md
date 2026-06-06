# NovelForge - AI智能小说创作工作台

## 快速开始（Vue Web 前端）

### 前置条件
- Node.js 18+
- Docker（用于 PostgreSQL 数据库）
- Python 3.11+（用于后端）

### 第一步：启动数据库

```bash
# 拉取并启动 PostgreSQL
docker run -d \
  --name novelforge-pg \
  -e POSTGRES_USER=root \
  -e POSTGRES_PASSWORD=123456 \
  -e POSTGRES_DB=novelforge \
  -p 5432:5432 \
  postgres:16
```

### 第二步：初始化数据库

```bash
# 导入表结构
docker exec -i novelforge-pg psql -U root -d novelforge < sql/schema.sql

# 导入初始数据（admin 账号）
docker exec -i novelforge-pg psql -U root -d novelforge < sql/seed.sql
```

### 第三步：启动后端

```bash
cd backend

# 创建虚拟环境
python -m venv .venv

# 激活虚拟环境（Windows）
.venv\Scripts\activate

# 安装依赖
pip install -r requirements.txt

# 创建 .env 文件（参考 .env.example）
cp .env.example .env

# 启动后端
python -m uvicorn app.main:app --host 0.0.0.0 --port 9000 --reload
```

### 第四步：启动 Vue 前端

```bash
cd web-frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev -- --port 5200
```

### 访问地址
- 前端: http://localhost:5200
- 后端 API: http://localhost:9000
- API 文档: http://localhost:9000/docs

### 测试账号
- 用户名: admin
- 密码: 123456

---

## 项目结构

```
novelforge-app/
├── backend/              # FastAPI 后端
│   ├── app/
│   │   ├── models/       # 数据库模型
│   │   ├── routers/      # API 路由
│   │   └── utils/        # 工具函数
│   └── requirements.txt  # Python 依赖
├── web-frontend/         # Vue 3 前端
│   ├── src/
│   │   ├── api/          # API 请求
│   │   ├── components/   # 组件
│   │   ├── views/        # 页面
│   │   └── stores/       # 状态管理
│   └── package.json      # Node 依赖
├── frontend/             # Flutter 移动端（可选）
├── extension/            # Chrome 扩展（可选）
├── sql/                  # 数据库初始化脚本
│   ├── schema.sql        # 表结构
│   └── seed.sql          # 初始数据
└── start-web.bat         # 一键启动脚本
```

## 一键启动（Windows）

```bash
# 双击运行
start-web.bat
```

## 功能特性

- 📝 智能编辑器（Markdown + 富文本）
- 🌍 世界观设定管理（9大模块）
- 👥 角色管理 + 关系图谱
- 🤖 AI 辅助创作（DeepSeek 集成）
- 📊 项目管理 + 章节组织
- 🔀 版本分支管理

## 技术栈

- **前端**: Vue 3 + Vite + Element Plus + Pinia
- **后端**: FastAPI + SQLAlchemy + PostgreSQL
- **AI**: DeepSeek API（免费版 + 扩展版）
