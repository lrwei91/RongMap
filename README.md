# RongMap

基于高德地图的福州地点收藏与分享工具。手动搜索添加、AI 对话录入，地点数据存放在 Vercel KV。

## Vercel 部署

```bash
npm install -g vercel
vercel login
vercel          # 首次部署，按提示设置项目名称
vercel --prod   # 生产环境部署
```

### KV 数据库

1. Vercel Dashboard → 项目 → **Storage** → 创建 **KV** 数据库
2. 环境变量会自动注入（`KV_URL`、`KV_REST_API_TOKEN` 等）

> 备注：Vercel 官方已将 `@vercel/kv` 标记为 deprecated，迁移到 Vercel Marketplace → Upstash Redis integration 后，代码无需改动（`@vercel/kv` 在 Upstash 提供的 KV 实例上仍可继续工作）。

### 环境变量

| 变量 | 说明 |
|------|------|
| `AMAP_WEB_SERVICE_KEY` | 高德 Web 服务 API Key（用于 `/api/share-map`、`/api/share-poi`）。留空则使用代码内置默认值，建议部署时覆盖 |
| `OPENCLAW_SHARED_SECRET` | AI 录入接口的 Bearer Token。`/api/openclaw/*` 鉴权使用，部署时必填 |

> 前端 JS API Key（`AMAP_WEB_*`）和 Security Code 在 `public/index.html` 中硬编码，如需更换请同步修改。

### KV 本地备份

```bash
npm run backup:kv
```

将云端 `locations` 数据同步到 `data/backups/`。脚本支持两种数据源：有 `KV_REST_API_*` 环境变量时直连 KV；否则通过 `vercel curl` 抓取最新 Ready 部署的 `/api/locations`。

## API 端点

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/locations` | 获取所有地点 |
| POST | `/api/locations` | 新增地点（手动 / 搜索结果） |
| PUT | `/api/locations?id=xxx` | 更新地点（含编辑、坐标） |
| DELETE | `/api/locations?id=xxx` | 删除地点 |
| POST | `/api/search` | 高德地点搜索（前端降级用） |
| GET | `/api/share-map` | 高德静态地图（分享海报用） |
| GET | `/api/share-poi` | 高德 POI 详情（评分、营业时间等） |
| POST | `/api/openclaw/locations/intake` | AI 录入入口（需 Bearer Token） |
| POST | `/api/openclaw/locations/confirm` | AI 二次确认后落库（需 Bearer Token） |

### 地点字段

| 字段 | 说明 |
|------|------|
| `id` | 地点唯一 ID |
| `name` | 名称 |
| `address` | 地址 |
| `latitude` / `longitude` | 坐标，可为 `null`（待定位） |
| `category` | `food` 餐饮美食 / `spot` 景点休闲 / `cafe_bar` 日咖夜酒 |
| `reason` | 添加理由（可选） |
| `sourceType` | `manual` / `text` / `map_location` / `douyin_url` / `video` |
| `sourceId` | 高德 POI ID（用于去重） |
| `createdAt` | ISO 8601 时间戳 |

### 去重规则

1. `sourceId` 完全匹配
2. 规范化后的 `name + address` 完全匹配
3. 名称相同 + 地址子串兼容（任一方 ≥ 8 字符）
4. 坐标距离 ≤ 20 米 + 名称完全相同 + 地址/行政区兼容

## 项目结构

```
RongMap/
├── api/                          # Vercel Serverless 函数
│   ├── locations.js              # 地点 CRUD
│   ├── search.js                 # 高德搜索代理
│   ├── share-map.js              # 静态地图
│   ├── share-poi.js              # POI 详情
│   └── openclaw/locations/       # AI 录入 / 确认
├── lib/                          # 共享工具
│   ├── amap.js                   # 高德客户端 + 城市/分类规则
│   ├── location-category.js      # 分类标准化
│   ├── location-coordinates.js   # 坐标校验 + 距离
│   ├── location-duplicate.js     # 去重规则
│   ├── location-intake.js        # AI 录入管道
│   ├── location-record.js        # 地点 record 构建
│   └── locations-storage.js      # KV 存储封装
├── public/                       # 前端资源
│   ├── index.html
│   ├── app.js
│   └── style.css
├── scripts/
│   └── backup-kv.js              # KV 备份脚本
├── vercel.json
└── package.json
```
