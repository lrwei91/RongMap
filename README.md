# RongMap - 福州地图标记应用

一个基于高德地图的地点标记与分享应用，支持手动添加、AI 对话录入、批量导入等方式记录地点。

## 快速开始

### 1. 获取高德地图 API Key

访问 [高德开放平台](https://console.amap.com/) 注册并创建应用：

1. **Web 端 (JS API)** — 用于前端地图展示
2. **Web 服务** — 用于地理编码 / POI 搜索

### 2. 配置 API Key

编辑 `public/app.js`：

```javascript
const AMAP_CONFIG = {
  webApiKey: '你的 WEB 端 API Key',
  webServiceKey: '你的 WEB 服务 API Key',
  securityCode: '你的安全密钥'
};
```

同时编辑 `public/index.html`，替换 `YOUR_SECURITY_CODE` 和 `YOUR_WEB_API_KEY`。

### 3. 启动服务

```bash
npm start
```

访问 http://localhost:3000

## 使用方法

- **单个添加**：输入地址（如 `群哥水煮蛙 仓山万达店`），点击添加
- **批量添加**：粘贴多行地址，每行一个，点击批量添加
- **AI 录入**：通过 OpenClaw 对话添加地点（见下方 API 文档）
- **地图筛选**：按分类（餐饮/景点/购物/交通等）过滤标记点
- **分享**：生成地点分享链接

## 数据存储

- 本地开发：`data/locations.json`
- 线上部署：Vercel KV（分布式存储，多人共享）

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
| `OPENCLAW_SHARED_SECRET` | OpenClaw 鉴权密钥 |

KV 相关变量由 Vercel 自动创建，无需手动配置。

### KV 本地备份

```bash
npm run backup:kv
```

将云端 `locations` 数据同步到 `data/backups/`。

## OpenClaw API

### 地点录入

```
POST /api/openclaw/locations/intake
Authorization: Bearer <OPENCLAW_SHARED_SECRET>
```

请求体支持：
- `query` — 简短地点词
- `inputType` — `text` / `map_location` / `douyin_url` / `video`
- `category` — 地点分类（支持中文别名）
- `reason` — 添加原因

响应状态：`saved` / `needs_confirmation` / `duplicate` / `not_found`

### 地点确认

```
POST /api/openclaw/locations/confirm
Authorization: Bearer <OPENCLAW_SHARED_SECRET>
```

用于多候选场景下的二次确认。

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
├── data/                    # 本地数据（线上用 KV）
├── server.js                # Express 本地服务
├── vercel.json              # Vercel 配置
└── package.json
```
