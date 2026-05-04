# RongMap - 福州地图标记应用

一个基于高德地图的地点标记与分享应用，支持手动添加、AI 对话录入等方式记录地点。所有数据存储在 Vercel KV 云端。

## Vercel 部署

### 步骤

```bash
npm install -g vercel
vercel login
vercel          # 首次部署，按提示设置项目名称
vercel --prod   # 生产环境部署
```

### KV 数据库

1. 在 Vercel Dashboard 进入项目 → **Storage** → 创建 **KV** 数据库
2. 环境变量会自动注入（`KV_URL`、`KV_REST_API_TOKEN` 等）

### 环境变量

| 变量 | 说明 |
|------|------|
| `AMAP_WEB_KEY` | 高德 Web 端 API Key（可选） |
| `AMAP_WEB_SECURITY_CODE` | 高德安全密钥（可选） |
| `AMAP_WEB_SERVICE_KEY` | 高德 Web 服务 API Key |
| `OPENCLAW_SHARED_SECRET` | API 鉴权密钥 |

KV 相关变量由 Vercel 自动创建，无需手动配置。

### KV 本地备份

```bash
npm run backup:kv
```

将云端 `locations` 数据同步到 `data/backups/`。

## API

### 地点录入

```
POST /api/openclaw/locations/intake
Authorization: Bearer <SECRET>
```

请求体：
- `query` — 简短地点词
- `inputType` — `text` / `map_location` / `douyin_url` / `video`
- `category` — 地点分类
- `reason` — 添加原因

响应状态：`saved` / `needs_confirmation` / `duplicate` / `not_found`

### 地点确认

```
POST /api/openclaw/locations/confirm
Authorization: Bearer <SECRET>
```

用于多候选场景下的二次确认。

### 查询地点

```
GET /api/locations
```

返回所有已收藏地点。

### 去重规则

1. 规范化后的 `name + address` 完全匹配
2. 坐标距离 < 50 米视为重复

### 鉴权

两个接口均需 Bearer Token，Token 值由 `OPENCLAW_SHARED_SECRET` 环境变量控制。

## 项目结构

```
RongMap/
├── api/                     # Vercel Serverless 函数
├── lib/                     # 共享工具库（存储、高德搜索等）
├── public/                  # 前端资源
│   ├── index.html
│   ├── app.js
│   └── style.css
├── scripts/                 # 运维脚本
├── vercel.json              # Vercel 配置
└── package.json
```
