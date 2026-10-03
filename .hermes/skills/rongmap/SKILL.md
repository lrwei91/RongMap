---
name: rongmap
description: 用于维护 RongMap 的共享地图、地点批量操作、行程编排、旅行路书与 AI 规划、Supabase 迁移、只读分享或 Vercel API 时
version: 1.1.0
author: lrwei91
license: MIT
metadata:
  hermes:
    tags: [rongmap, vite, supabase, maps, trips, roadbook]
---

# RongMap

面向亲友共享的福州地点地图、行程与旅行路书工作台。

## 边界

- 保持 React + Vite 前端、Supabase 认证/数据库/实时更新和 Vercel API 的现有架构。
- 私有 API 必须校验 Supabase Access Token、空间成员和角色；未配置 Supabase 时默认关闭共享工作台。
- 空间归属由服务端按登录用户的 `space_members` 关系解析，不接受客户端指定 `spaceId`。
- 登录只用用户名，不发邮件、不存密码；不要重新引入邮箱验证或邀请回跳流程。
- 地点更新使用 `version` 乐观并发控制；`409` 必须展示最新记录，不静默覆盖他人修改。
- 更新地点时未传 `tagIds` 表示保留原有标签关联，只有显式传空数组才清空；不要用 `|| []` 把两者混同。
- 行程路线优化保留未定位地点的相对顺序，并把它们放在当天末尾；不要为了“优化”丢失地点。
- 回收站保留 30 天由 `shared-store` 的惰性清理实现，不要改成只显示倒计时而不删除。
- AI 规划返回草案，不直接写库；名称、地址、坐标以服务端真源为准，票价强制留空待核实。
- KV 备份、共享空间迁移、管理员账号初始化、生产部署和密钥写入都是高影响操作，先确认范围和备份状态。

## 核心结构

| 区域 | 用途 | 关键约束 |
|---|---|---|
| `/app/map`、`/app/locations` | 地图工作台、地点筛选和批量操作 | 地图固定尺寸，地点列表自然滚动 |
| `/app/trips`、`/app/trips/:id` | 共享行程、分天编排、路线优化 | 保留撤销/重做、只读分享和版本保存 |
| `/app/roadbook`、`/app/roadbook/:id` | 旅行路书列表与四步向导 | 步骤固定为规划草案 → 出行需求 → 预算与提醒 → 完整路书；路线核实、导出与分享只在最后一步 |
| `/app/trash` | 30 天回收站 | 软删除优先，管理员永久清理；`/app/activity` 无独立导航项，仅旧链接兼容 |
| `/app/share-links`、`/share/:token` | 管理只读链接和公开读取 | 支持空间/单行程范围，撤销后不可继续读取 |
| `api/` | Vercel 入口：`locations.js`(已弃用)、`search.js`、`v2/[route].js` | Serverless Function 上限 12 个，由 `npm run check` 强制 |
| `lib/api-v2/` | v2 各路由处理函数 | 新路由同步前端、权限、测试和旧兼容路径 |
| `lib/server-supabase.js`、`lib/shared-store.js` | 身份解析、鉴权与共享数据读写 | 空间与成员校验的唯一真源 |
| `scripts/` | 自检、KV 备份、共享迁移、空间重置 | 先 preview/备份，再执行生产写入 |

## 使用

```bash
# 开始前保护已有改动
git status --short --branch

# 基础门禁
npm run check
npm test
npm run build

# 关键流程
npm run test:e2e

# 本地开发；需要完整 API 联调时另开 vercel dev
npm run dev
vercel dev
```

执行 `npm run backup:kv` 或 `npm run migrate:shared` 前，先确认环境、目标空间、备份和授权；不输出任何密钥值。

## 当前 5 大坑

### 1. 把 Supabase 缺失当成管理员身份

**触发**：本地没有 Supabase 配置却测试共享工作台。**表现**：访客被错误识别成管理员或出现假数据。**修法**：保持服务端关闭共享的默认行为，UI 测试用 route mock 或明确本地数据模式。

### 2. 迁移没有先备份和核对空间

**触发**：直接运行 `migrate:shared`。**表现**：旧地点写入错误空间或迁移条数无法追溯。**修法**：维护窗口冻结旧写入，先 `backup:kv`，再核对输出 `spaceId` 和条数。

### 3. 绕过版本冲突

**触发**：收到 `409` 后继续覆盖提交。**表现**：成员更新丢失。**修法**：读取最新记录，合并用户意图，再按新 `version` 重试。

### 4. 破坏旧 API 兼容路径

**触发**：只改 `/api/v2` 或删除旧接口。**表现**：迁移窗口内旧客户端中断。**修法**：同步兼容路由、fixture、前端调用和测试，确认下线边界后再删。

### 5. 把真实地图/邮件/Realtime 当本地构建证据

**触发**：`npm run build` 通过。**表现**：生产权限、Realtime 或高德限制仍未验证。**修法**：分开报告本地 check/test/e2e 与预览环境真实验证，网络或风控失败不能伪装成通过。

### 6. 把 30 天回收站写成只有倒计时

**触发**：只改 UI 文案或只展示剩余天数。**表现**：承诺「0 天后清理」但记录永远留在库里。**修法**：保留 `shared-store` 的惰性清理，过期条目在 `bootstrap` 读取时真正删除。

## 验证清单

- [ ] `.env.local`、Supabase secret、默认密码和共享 token 未被读取或输出到结果。
- [ ] API/权限改动覆盖鉴权、角色、空间边界、失败路径和旧兼容路由。
- [ ] `npm run check`、`npm test`、相关 `test:e2e` 实际通过或明确记录阻塞。
- [ ] 迁移脚本未在本轮无授权执行；生产写入前有备份和目标确认。
- [ ] UI 改动检查 320、390、768、1024、1440 CSS px、移动横屏和 reduced-motion。
- [ ] 文档中的路径、变量名、接口清单与实际代码一致；新增能力同步 README 与本 skill。

## references/

本 skill 无 `references/` 目录。项目真源是 `README.md`（现状约定）与 `supabase/migrations/`（数据结构）；`docs/` 存放历史设计档案，不作为当前规范。
