# 福州地图标记应用

## 快速开始

### 1. 获取高德地图 API Key

访问 [高德开放平台](https://console.amap.com/) 注册账号并创建应用：

1. 进入 **控制台** → **应用管理** → **我的应用**
2. 点击 **创建新应用**
3. 创建两个 Key：

   **Key 1 - Web 端 (JS API)**
   - 服务平台：Web 端 (JS API)
   - 安全密钥：记下这个安全密钥 (securityCode)

   **Key 2 - Web 服务**
   - 服务平台：Web 服务
   - 用于地理编码 API

### 2. 配置 API Key

编辑 `public/app.js` 文件，替换以下配置：

```javascript
const AMAP_CONFIG = {
  webApiKey: '你的 WEB 端 API Key',
  webServiceKey: '你的 WEB 服务 API Key',
  securityCode: '你的安全密钥'
};
```

编辑 `public/index.html` 文件，替换：
- `YOUR_SECURITY_CODE` → 你的安全密钥
- `YOUR_WEB_API_KEY` → 你的 WEB 端 API Key

### 3. 启动服务

```bash
npm start
```

访问 http://localhost:3000

## 使用方法

1. **单个添加**: 在输入框输入地址，如 `群哥水煮蛙 仓山万达店`，点击添加
2. **批量添加**: 在文本框粘贴多行地址，每行一个，点击批量添加
3. 系统会自动调用高德地图进行地理编码，在地图上标记位置

## 数据说明

所有地点数据存储在 `data/locations.json` 文件中
