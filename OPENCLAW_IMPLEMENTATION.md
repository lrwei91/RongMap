# OpenClaw 对话直写 Vercel KV 方案 - 实施总结

## 实施日期
2026-04-04

## 已完成功能

### ✅ 1. 共享地点存储 Helper
**文件：** `lib/locations-storage.js`

功能：
- `getLocations()` - 获取所有地点
- `saveLocations()` - 保存所有地点
- `createLocation()` - 创建新地点（含去重检查）
- `isDuplicateLocation()` - 检查地点是否重复
- `normalizeText()` - 文本规范化
- `getDistance()` - 计算两点间距离（Haversine 公式）

去重规则：
1. 规范化后的 `name + address` 精确匹配
2. 坐标距离 < 50 米视为重复

---

### ✅ 2. OpenClaw Intake 接口
**文件：** `api/openclaw/locations/intake.js`
**端点：** `POST /api/openclaw/locations/intake`

功能：
- Bearer Token 鉴权
- 高德 POI 搜索
- 置信度评估（high/medium/low）
- 单一高置信地点自动保存
- 多候选返回供确认
- 重复地点检测

响应状态：
- `saved` - 已自动保存
- `needs_confirmation` - 需要确认（返回最多 3 个候选）
- `duplicate` - 地点已存在
- `not_found` - 未找到相关地点

---

### ✅ 3. OpenClaw Confirm 接口
**文件：** `api/openclaw/locations/confirm.js`
**端点：** `POST /api/openclaw/locations/confirm`

功能：
- Bearer Token 鉴权
- 候选地点确认落库
- 重复检测

响应状态：
- `saved` - 保存成功
- `duplicate` - 地点已存在

---

### ✅ 4. 路由集成
**文件：** `server.js`

已添加路由：
```javascript
app.use('/api/openclaw/locations/intake', require('./api/openclaw/locations/intake'));
app.use('/api/openclaw/locations/confirm', require('./api/openclaw/locations/confirm'));
```

---

### ✅ 5. 环境变量配置
**文件：** `.env.example`

新增变量：
```bash
# OpenClaw 共享密钥（用于鉴权）
OPENCLAW_SHARED_SECRET=your-secret-key-here
```

---

### ✅ 6. 测试脚本
**文件：** `test-openclaw-intake.js`

测试用例：
1. 缺少鉴权 -> 401
2. 缺少 query 参数 -> 400
3. 搜索已知地点（三坊七巷）
4. 搜索模糊地点（万达广场）
5. 确认候选地点
6. 重复地点检测

运行方式：
```bash
export OPENCLAW_SHARED_SECRET=test-secret-123
npm start
node test-openclaw-intake.js
```

---

### ✅ 7. API 文档
**文件：** `docs/OPENCLAW_API.md`

包含：
- 接口说明
- 请求/响应示例
- 错误处理
- OpenClaw 对话流程
- 环境变量配置
- 测试指南

---

## 待完成功能

### 🔄 1. Vercel 部署配置
需要在 Vercel 环境变量中设置：
- `OPENCLAW_SHARED_SECRET`
- KV 相关配置

### 🔄 2. OpenClaw 技能侧集成
需要在 OpenClaw 侧创建技能调用新 API：
- 定义"新增地图地点"动作
- 处理 `needs_confirmation` 场景（展示候选列表）
- 用户回复编号后调用 confirm 接口

### 🔄 3. 现有网页端 API 鉴权改造（第二阶段）
当前 `/api/locations` 仍为公开写入口，如需封住需额外改造。

---

## 项目结构

```
RongMap/
├── api/
│   ├── openclaw/
│   │   └── locations/
│   │       ├── intake.js       # 地点录入接口
│   │       └── confirm.js      # 地点确认接口
│   └── locations.js            # 现有地点 API
├── lib/
│   ├── amap.js                 # 高德搜索（复用）
│   └── locations-storage.js    # 共享存储 helper（新增）
├── docs/
│   └── OPENCLAW_API.md         # API 文档
├── server.js                   # Express 服务（已集成路由）
├── .env.example                # 环境变量示例
├── test-openclaw-intake.js     # 测试脚本
└── OPENCLAW_IMPLEMENTATION.md  # 本文档
```

---

## 使用示例

### 场景 1: 单一高置信地点

```bash
curl -X POST http://localhost:3000/api/openclaw/locations/intake \
  -H "Authorization: Bearer your-secret" \
  -H "Content-Type: application/json" \
  -d '{"query": "三坊七巷", "city": "福州"}'
```

响应：
```json
{
  "status": "saved",
  "location": {
    "id": "1712345678901",
    "name": "三坊七巷",
    "address": "福建省福州市鼓楼区东街口",
    ...
  }
}
```

### 场景 2: 多候选确认

```bash
# Step 1: 搜索
curl -X POST http://localhost:3000/api/openclaw/locations/intake \
  -H "Authorization: Bearer your-secret" \
  -H "Content-Type: application/json" \
  -d '{"query": "万达广场", "city": "福州"}'
```

响应：
```json
{
  "status": "needs_confirmation",
  "candidates": [
    {"id": 1, "name": "万达广场 (台江店)", "address": "..."},
    {"id": 2, "name": "万达广场 (仓山店)", "address": "..."},
    {"id": 3, "name": "万达广场 (五四北店)", "address": "..."}
  ]
}
```

```bash
# Step 2: 确认
curl -X POST http://localhost:3000/api/openclaw/locations/confirm \
  -H "Authorization: Bearer your-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "candidate": {
      "name": "万达广场 (台江店)",
      "address": "台江区鳌江路 8 号",
      "latitude": 26.06234,
      "longitude": 119.33456
    }
  }'
```

---

## 注意事项

1. **鉴权安全**：`OPENCLAW_SHARED_SECRET` 应使用强随机字符串，不要在代码中硬编码
2. **无状态设计**：候选不落临时表，由 OpenClaw 在下次请求中原样回传
3. **去重逻辑**：先 name+address 精确匹配，再坐标距离判断
4. **置信度评估**：基于名称匹配度、坐标完整性、地址完整性、POI 类型
5. **本地测试**：使用 `server.js` 运行（文件存储），Vercel 部署时自动使用 KV

---

## 下一步

1. **设置密钥**：生成 `OPENCLAW_SHARED_SECRET` 并配置到 Vercel
2. **本地测试**：运行 `node test-openclaw-intake.js` 验证功能
3. **OpenClaw 集成**：在 OpenClaw 侧创建技能调用新 API
4. **部署验证**：部署到 Vercel 后进行端到端测试
