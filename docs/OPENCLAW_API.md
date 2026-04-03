# OpenClaw 地点录入 API 文档

## 概述

OpenClaw 地点录入 API 允许 OpenClaw 通过对话方式向 RongMap 添加地点，无需直接连接数据库。

**设计原则：**
- 受保护的 API（需要 Bearer Token 鉴权）
- 复用现有高德搜索和 KV 存储能力
- 无状态设计（候选不落临时表）
- 第一版仅支持单条地点新增

---

## 鉴权

两个接口都需要在 Header 中携带鉴权 Token：

```
Authorization: Bearer <OPENCLAW_SHARED_SECRET>
```

---

## 接口 1: 地点录入 (Intake)

**端点：** `POST /api/openclaw/locations/intake`

### 请求参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `query` | string | ✅ | 地点名称（自由文本） |
| `category` | string | ❌ | 地点分类 |
| `reason` | string | ❌ | 添加原因 |
| `city` | string | ❌ | 搜索城市，默认"福州" |

### 响应状态

#### 1. `saved` - 已自动保存

单个高置信度地点，已自动写入 KV。

```json
{
  "status": "saved",
  "message": "地点已自动保存",
  "location": {
    "id": "1712345678901",
    "name": "三坊七巷",
    "address": "福建省福州市鼓楼区东街口",
    "latitude": 26.08528,
    "longitude": 119.29653,
    "category": null,
    "reason": null,
    "createdAt": "2026-04-04T01:23:45.678Z"
  },
  "category": null,
  "reason": null
}
```

#### 2. `needs_confirmation` - 需要确认

找到多个候选地点，需要用户确认。

```json
{
  "status": "needs_confirmation",
  "message": "找到多个候选地点，请确认",
  "query": "万达广场",
  "candidates": [
    {
      "id": 1,
      "name": "万达广场 (台江店)",
      "address": "福建省福州市台江区鳌峰街道鳌江路 8 号",
      "latitude": 26.06234,
      "longitude": 119.33456,
      "type": "购物服务;商场;综合性商场",
      "confidence": "high"
    },
    {
      "id": 2,
      "name": "万达广场 (仓山店)",
      "address": "福建省福州市仓山区浦上大道 276 号",
      "latitude": 26.03456,
      "longitude": 119.28901,
      "type": "购物服务;商场;综合性商场",
      "confidence": "high"
    },
    {
      "id": 3,
      "name": "万达广场 (五四北店)",
      "address": "福建省福州市晋安区南平东路",
      "latitude": 26.12345,
      "longitude": 119.31234,
      "type": "购物服务;商场;综合性商场",
      "confidence": "medium"
    }
  ],
  "category": null,
  "reason": null
}
```

#### 3. `duplicate` - 重复地点

地点已存在，不重复写入。

```json
{
  "status": "duplicate",
  "message": "地点已存在",
  "reason": "name_address_match",
  "existing": {
    "id": "1712345678901",
    "name": "三坊七巷",
    "address": "福建省福州市鼓楼区东街口",
    ...
  }
}
```

#### 4. `not_found` - 未找到

未找到相关地点。

```json
{
  "status": "not_found",
  "message": "未找到相关地点",
  "query": "xxx"
}
```

---

## 接口 2: 地点确认 (Confirm)

**端点：** `POST /api/openclaw/locations/confirm`

用于多候选场景下的二次确认。

### 请求参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `candidate` | object | ✅ | 选中的候选地点对象 |
| `candidate.name` | string | ✅ | 地点名称 |
| `candidate.address` | string | ✅ | 地点地址 |
| `candidate.latitude` | number | ❌ | 纬度 |
| `candidate.longitude` | number | ❌ | 经度 |
| `category` | string | ❌ | 地点分类 |
| `reason` | string | ❌ | 添加原因 |

### 请求示例

```json
{
  "candidate": {
    "name": "万达广场 (台江店)",
    "address": "福建省福州市台江区鳌峰街道鳌江路 8 号",
    "latitude": 26.06234,
    "longitude": 119.33456
  },
  "category": "购物",
  "reason": "用户添加"
}
```

### 响应示例

#### 成功保存

```json
{
  "status": "saved",
  "message": "地点已保存",
  "location": {
    "id": "1712345678902",
    "name": "万达广场 (台江店)",
    "address": "福建省福州市台江区鳌峰街道鳌江路 8 号",
    "latitude": 26.06234,
    "longitude": 119.33456,
    "category": "购物",
    "reason": "用户添加",
    "createdAt": "2026-04-04T01:25:00.000Z"
  }
}
```

#### 重复地点

```json
{
  "status": "duplicate",
  "message": "地点已存在",
  "reason": "name_address_match",
  "existing": {
    "id": "1712345678901",
    "name": "万达广场 (台江店)",
    ...
  }
}
```

---

## 错误处理

### 401 Unauthorized

缺少或错误的鉴权 Token。

```json
{
  "error": "未授权",
  "code": "UNAUTHORIZED"
}
```

### 400 Bad Request

请求参数缺失或无效。

```json
{
  "error": "query 必填",
  "code": "MISSING_QUERY"
}
```

### 405 Method Not Allowed

使用了不支持的 HTTP 方法。

```json
{
  "error": "方法不允许",
  "allowed": "POST"
}
```

### 500 Internal Server Error

服务器错误。

```json
{
  "error": "服务器错误",
  "message": "具体错误信息",
  "code": "INTERNAL_ERROR"
}
```

---

## OpenClaw 对话流程

### 场景 1: 单一高置信地点

```
用户：帮我添加"三坊七巷"到地图

OpenClaw -> API: POST /intake { query: "三坊七巷" }
API -> OpenClaw: { status: "saved", location: {...} }
OpenClaw -> 用户：✅ 已添加"三坊七巷"到地图
```

### 场景 2: 多个候选地点

```
用户：帮我添加"万达广场"到地图

OpenClaw -> API: POST /intake { query: "万达广场" }
API -> OpenClaw: { status: "needs_confirmation", candidates: [...] }

OpenClaw -> 用户：
找到以下候选地点，请选择：
1. 万达广场 (台江店) - 台江区鳌江路 8 号
2. 万达广场 (仓山店) - 仓山区浦上大道 276 号
3. 万达广场 (五四北店) - 晋安区南平东路

用户：1

OpenClaw -> API: POST /confirm { candidate: candidates[0] }
API -> OpenClaw: { status: "saved", location: {...} }
OpenClaw -> 用户：✅ 已添加"万达广场 (台江店)"到地图
```

---

## 环境变量

在 Vercel 或本地 `.env` 文件中配置：

```bash
# OpenClaw 共享密钥（用于鉴权）
OPENCLAW_SHARED_SECRET=your-secret-key-here

# Vercel KV 配置
KV_URL=...
KV_REST_API_URL=...
KV_REST_API_TOKEN=...

# 高德地图 API
AMAP_WEB_SERVICE_KEY=...
```

---

## 测试

运行测试脚本：

```bash
# 设置密钥
export OPENCLAW_SHARED_SECRET=test-secret-123

# 启动服务
npm start

# 运行测试
node test-openclaw-intake.js
```

---

## 去重规则

1. **精确去重**：规范化后的 `name + address` 完全匹配
2. **坐标去重**：若候选和已有记录都带坐标，距离 < 50 米视为重复

---

## 数据结构

保存到 KV 的地点对象：

```typescript
{
  id: string;           // 时间戳生成
  name: string;         // 地点名称
  address: string;      // 地点地址
  latitude: number | null;  // 纬度
  longitude: number | null; // 经度
  category: string | null;  // 分类
  reason: string | null;    // 添加原因
  createdAt: string;    // ISO 8601 时间戳
}
```

---

## 后续优化（第二阶段）

- [ ] 支持批量导入
- [ ] 支持地点编辑/删除
- [ ] 网页端 API 鉴权改造
- [ ] 临时会话状态存储（用于超时未确认清理）
- [ ] 地点合并功能
