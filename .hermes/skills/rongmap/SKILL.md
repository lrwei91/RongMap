---
name: rongmap
description: 用于维护 RongMap 的共享地图、地点批量操作、行程编排、Supabase 迁移、只读分享或 Vercel API 时
version: 1.0.0
author: lrwei91
license: MIT
metadata:
  hermes:
    tags: [rongmap, vite, supabase, maps, trips]
---

# RongMap

面向亲友共享的福州地点地图与行程工作台。

## 边界

- 保持 React + Vite 前端、Supabase 认证/数据库/实时更新和 Vercel API 的现有架构。
- 私有 API 必须校验 Supabase Access Token、空间成员和角色；未配置 Supabase 时默认关闭共享工作台。
- 地点更新使用 `version` 乐观并发控制；`409` 必须展示最新记录，不静默覆盖他人修改。
- 行程路线优化保留未定位地点的相对顺序，并把它们放在当天末尾；不要为了“优化”丢失地点。
- KV 备份、共享空间迁移、成员默认密码、生产部署和密钥写入都是高影响操作，先确认范围和备份状态。

## 核心结构

| 区域 | 用途 | 关键约束 |
|---|---|---|
| `/app/map`、`/app/locations` | 地图工作台、地点筛选和批量操作 | 地图固定尺寸，地点列表自然滚动 |
| `/app/trips`、`/app/trips/:id` | 共享行程、分天编排、路线优化 | 保留撤销/重做、只读分享和版本保存 |
| `/app/activity`、`/app/trash` | 活动记录和 30 天回收站 | 删除优先软删除，恢复/清理区分权限 |
| `/app/share-links`、`/share/:token` | 管理只读链接和公开读取 | 支持空间/单行程范围，撤销后不可继续读取 |
| `/api/v2/`、`api/_lib/` | API v2、鉴权、路由和共享逻辑 | 新路由同步前端、权限、测试和旧兼容路径 |
| `scripts/` | KV 备份、共享迁移、成员密码 | 先 preview/备份，再执行生产写入 |

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

执行 `npm run backup:kv`、`npm run migrate:shared` 或 `npm run members:set-default-password` 前，先确认环境、目标空间、备份和授权；不输出任何密钥值。

## 当前 5 大坑

### 1. 把 Supabase 缺失当成管理员身份

**触发**：本地没有 Supabase 配置却测试共享工作台。**表现**：访客被错误识别成管理员或出现假数据。**修法**：保持服务端关闭共享的默认行为，UI 测试用 route mock 或明确本地数据模式。

### 2. 迁移没有先备份和核对空间

**触发**：直接运行 `migrate:shared`。**表现**：旧地点写入错误空间或迁移条数无法追溯。**修法**：维护窗口冻结旧写入，先 `backup:kv`，再核对输出 `spaceId` 和条数。

### 3. 绕过版本冲突

**触发**：收到 `409` 后继续覆盖提交。**表现**：成员更新丢失。**修法**：读取最新记录，合并用户意图，再按新 `version` 重试。

### 4. 破坏旧 API 或 OpenClaw 兼容路径

**触发**：只改 `/api/v2` 或删除旧接口。**表现**：迁移窗口内旧客户端和录入链路中断。**修法**：同步兼容路由、fixture、前端调用和测试，确认下线边界后再删。

### 5. 把真实地图/邮件/Realtime 当本地构建证据

**触发**：`npm run build` 通过。**表现**：生产权限、邮件、Realtime 或高德限制仍未验证。**修法**：分开报告本地 check/test/e2e 与预览环境真实验证，网络或风控失败不能伪装成通过。

## 验证清单

- [ ] `.env.local`、Supabase secret、默认密码和共享 token 未被读取或输出到结果。
- [ ] API/权限改动覆盖鉴权、角色、空间边界、失败路径和旧兼容路由。
- [ ] `npm run check`、`npm test`、相关 `test:e2e` 实际通过或明确记录阻塞。
- [ ] 迁移脚本未在本轮无授权执行；生产写入前有备份和目标确认。
- [ ] UI 改动检查 320、390、768、1024、1440 CSS px、移动横屏和 reduced-motion。

## references/

本 skill 无 `references/` 目录；仓库 `README.md` 和 `docs/design-brief.md` 是当前项目真源。
