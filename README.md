# RongMap

RongMap 是面向亲友共享的福州地点地图工作台。成员可以共同收藏、筛选、批量整理和恢复地点，管理员可以注册成员并创建可撤销的只读地图链接。

## 产品结构

- `/app/map`：三栏地图工作台，地点列表自然滚动，地图保持固定尺寸。
- `/app/locations`：全量地点、组合筛选、排序和批量操作。
- `/app/trips`：共享行程列表；可从已选地点创建逐日行程。
- `/app/trips/:id`：分天编排、跨天移动、路线优化、撤销重做和只读分享。
- `/app/activity`：成员活动记录。
- `/app/trash`：30天回收站。
- `/app/share-links`：管理员只读链接管理。
- `/app/settings`：成员用户名注册和自定义标签。
- `/share/:token`：无需登录的只读共享地图。
- `/auth/login`：只填用户名的登录页；无邮箱验证、无密码、无邀请回跳。

前端使用 React + Vite；生产认证、数据库和实时更新使用 Supabase；Vercel 继续托管前端与 Serverless API。原有 Vercel KV 读取在迁移窗口内保留兼容。

## 本地开发

```bash
npm install
npm run dev
```

仅开发 UI 时，可以使用 Playwright route mock 或将 `RONGMAP_REMOTE_FIRST=0` 写入本地环境；未配置 KV 的非生产环境会使用忽略提交的 `data/locations.local.json`。

完整 API 联调可另开终端运行：

```bash
vercel dev
```

Vite 默认将 `/api` 代理到 `http://localhost:3000`。

## 环境变量

复制 `.env.example` 为 `.env.local`，按部署环境填写：

| 变量 | 用途 |
| --- | --- |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | 浏览器认证和实时订阅 |
| `SUPABASE_URL` / `SUPABASE_SECRET_KEY` | Serverless 管理客户端；Secret 只放服务端 |
| `RONGMAP_DEFAULT_MEMBER_PASSWORD` | 服务端共享默认密码；至少 8 位，成员从不接触，只放服务端 |
| `INITIAL_ADMIN_USERNAME` / `INITIAL_ADMIN_NAME` | 首位管理员的用户名与显示名 |
| `RONGMAP_DEFAULT_SPACE_ID` | OpenClaw 和迁移脚本使用的默认空间 |
| `RONGMAP_LEGACY_MODE` | 仅本地旧版兼容调试设为 `1`；生产保持关闭 |
| `VITE_AMAP_WEB_KEY` / `VITE_AMAP_SECURITY_CODE` | 高德 JS 地图；必填，应在高德控制台限制允许域名 |
| `AMAP_WEB_SERVICE_KEY` | 地点搜索服务端接口；必填 |
| `OPENCLAW_SHARED_SECRET` | AI 录入接口 Bearer Token |

源码与 `.env.example` 已不再包含任何高德密钥，缺失时地图和搜索会直接提示缺哪个变量。这三个密钥曾以明文提交进历史，必须在高德控制台轮换后再更新 Vercel；轮换前旧密钥继续可用。

## Supabase 初始化与迁移

1. 在 Supabase SQL Editor 依次执行 `20260812_shared_spaces.sql`、`20260813_harden_shared_spaces.sql`、`20260817_trips.sql`、`20260817_harden_trips.sql` 和 `20260901_username_only_members.sql`。
2. 在环境变量中填写首位管理员的用户名（`INITIAL_ADMIN_USERNAME`），迁移脚本会直接创建该账号。
3. 在维护窗口冻结旧系统写入并执行 KV 备份。
4. 设置服务端环境变量后运行：

```bash
npm run backup:kv
npm run migrate:shared
```

迁移脚本会创建默认共享空间、管理员成员关系，并保留旧地点的名称、地址、分类、坐标、备注、来源和创建时间。切换生产流量前核对输出的 `spaceId` 和迁移条数。

管理员在 `/app/settings` 输入用户名和姓名即可注册成员，对方立即可用该用户名登录。用户名内部映射为 `用户名@rongmap.local` 伪邮箱（Supabase Auth 只认邮箱），成员全程不接触邮箱和密码。

需要推倒重来时，清空 Supabase 侧全部空间数据和账号，再重跑迁移：

```bash
npm run backup:kv
npm run reset:space          # 演练，只统计将删除的数据
npm run reset:space -- --yes # 确认备份后真正清空
npm run migrate:shared       # 重建管理员、空间和地点
```

旧邮箱账号无法用用户名登录，建议在清空前先记录需要保留的用户名。

> 取舍：知道用户名即可进入共享空间，无第二道凭据。需要更强身份校验时，在 `lib/member-auth.js` 的 `signInMember` 处接回密码或 TOTP 即可，前端其余链路无需改动。

## API v2

| 路径 | 能力 |
| --- | --- |
| `GET /api/v2/bootstrap` | 当前空间、成员、地点、行程摘要、标签、活动、回收站和链接 |
| `/api/v2/locations` | 创建、版本化更新和软删除地点 |
| `/api/v2/trips` | 行程摘要、完整行程、版本化保存、路线优化和删除 |
| `/api/v2/trash` | 恢复和管理员永久清理 |
| `POST /api/v2/bulk` | 批量标签和移入回收站 |
| `/api/v2/import-preview` / `import-commit` | 导入预览与提交 |
| `/api/v2/tags` / `members` | 标签和成员用户名注册管理 |
| `POST /api/v2/session` | 用户名换取登录会话（唯一免鉴权入口） |
| `/api/v2/share-links` / `public-share` | 创建、撤销和读取只读链接 |

行程路线优化使用经纬度直线距离、全起点近邻搜索和 2-opt 局部优化；未定位地点保持原相对顺序并放在当天末尾。只读链接支持完整空间和单个行程两种范围。

私有接口必须携带 Supabase Access Token；所有操作继续校验空间成员与角色。未配置 Supabase 时服务端默认关闭共享工作台，避免访客被识别成管理员。地点更新提交 `version`，版本不一致返回 `409` 和最新记录。

旧 `/api/locations` 与 OpenClaw 路径在迁移发布周期内继续工作；OpenClaw 通过 `RONGMAP_DEFAULT_SPACE_ID` 路由默认空间。

## 验证

```bash
npm run check       # 服务端语法 + Vite生产构建
npm test            # 纯函数单元测试
npm run test:e2e    # Playwright共享工作台关键流程
```

视觉验收覆盖 320、390、768、1024、1440 CSS px、移动横屏、200%字体和 `prefers-reduced-motion`。真实高德地图、Supabase邮件、Realtime 和 Vercel生产路由需在预览部署环境完成最终验收。
