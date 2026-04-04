# EdgeOne Pages 部署说明

## 目录约定
- 静态站目录：`public`
- Edge Functions 目录：`edge-functions`
- EdgeOne 配置：`edgeone.json`

## 必填运行时配置
- 环境变量：`AMAP_SERVER_KEY`
- 环境变量：`OPENCLAW_SHARED_SECRET`
- KV 绑定变量：`RONGMAP_KV`

## EdgeOne 控制台配置
1. 导入当前仓库为 EdgeOne Pages 项目。
2. 输出目录设置为 `public`。
3. 绑定一个 KV namespace 到变量名 `RONGMAP_KV`。
4. 配置 `AMAP_SERVER_KEY` 与 `OPENCLAW_SHARED_SECRET`。

## 路由说明
- `/api/locations`
- `/api/locations/batch`
- `/api/locations/:id/geocode`
- `/api/search`
- `/api/geocode`
- `/api/openclaw/locations/intake`
- `/api/openclaw/locations/confirm`

## 本地联调
- `npm run edge:dev`

如果本地没有登录 EdgeOne CLI，`npx edgeone pages dev` 会要求先完成项目关联和环境同步。

## 初始数据迁移
- 现有地点数据不会自动从 Vercel KV 或本地 `data/locations.json` 迁移到 EdgeOne KV。
- 最简单的做法是先从旧环境导出 `locations` 数组，再对新站点调用 `POST /api/locations/batch` 一次性导入。
