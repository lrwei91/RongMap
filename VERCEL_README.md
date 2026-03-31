# 福州地图应用 - Vercel 部署指南

## 部署步骤

### 1. 安装 Vercel CLI

```bash
npm install -g vercel
```

### 2. 登录 Vercel

```bash
vercel login
```

### 3. 创建 KV 数据库

1. 访问 [vercel.com](https://vercel.com)
2. 进入你的项目（或先导入项目）
3. 点击 **Storage** → **Create Database** → 选择 **KV**
4. 创建完成后，Vercel 会自动连接环境变量

### 4. 部署项目

在项目根目录运行：

```bash
vercel
```

按照提示操作：
- 第一次部署会问是否链接到项目，选 **Yes**
- 设置项目名称
- 选择团队（个人账号就选自己的名字）

### 5. 生产环境部署

```bash
vercel --prod
```

## 环境变量

KV 数据库需要以下环境变量（Vercel 会自动创建）：
- `KV_URL`
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
- `KV_REST_API_READ_ONLY_TOKEN`

可在 Vercel Dashboard 的 **Settings → Environment Variables** 查看。

## 高德地图 API 密钥

当前使用硬编码的密钥，建议改为环境变量：

1. 在 Vercel Dashboard 添加环境变量 `AMAP_WEB_KEY` 和 `AMAP_WEB_SECURITY_CODE`
2. 更新 `public/index.html` 和 `api/*.js` 使用 `process.env`

## 访问应用

部署完成后，Vercel 会给你分配一个域名：
- 开发预览：`https://<project-name>-<git-branch>.vercel.app`
- 生产环境：`https://<project-name>.vercel.app`

所有访问用户都可以添加地址，数据存储在 KV 数据库中，所有人共享。
