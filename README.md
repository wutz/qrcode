# 📸 图片二维码生成器

基于 Cloudflare Workers + R2 的图片上传和二维码生成服务。

## ✨ 功能特性

- 🖼️ **图片上传** - 支持 JPG、PNG、GIF、WebP 等常见格式
- 📱 **二维码生成** - 自动生成图片链接的二维码
- 🌐 **多语言支持** - 中文、英文、日文、韩文
- 🎨 **主题切换** - 明亮/暗黑双主题
- ⚡ **极速响应** - 部署在 Cloudflare 全球边缘网络
- 💰 **低成本** - R2 无出口流量费用

## 🚀 快速开始

### 前置要求

- Node.js 18+
- Cloudflare 账号
- Wrangler CLI

### 安装依赖

```bash
npm install
```

### 创建 R2 存储桶

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 R2 存储
3. 创建名为 `qrcode-images` 的存储桶

### 本地开发

```bash
npm run dev
```

访问 http://localhost:8787

### 部署到 Cloudflare

```bash
npm run deploy
```

## 📁 项目结构

```
qrcode/
├── src/
│   └── index.ts      # Worker 主文件 (API + 前端)
├── package.json      # 依赖配置
├── wrangler.toml     # Cloudflare 配置
├── tsconfig.json     # TypeScript 配置
└── README.md         # 项目文档
```

## 🔧 API 接口

### POST /api/upload

上传图片并生成二维码

**请求**: `multipart/form-data`
- `file`: 图片文件

**响应**:
```json
{
  "success": true,
  "imageUrl": "https://your-worker.workers.dev/images/xxx.png",
  "qrCode": "data:image/png;base64,xxx",
  "fileName": "xxx.png"
}
```

### POST /api/qrcode

生成自定义 URL 的二维码

**请求**: `application/json`
```json
{
  "url": "https://example.com",
  "size": 300,
  "darkColor": "#000000",
  "lightColor": "#ffffff"
}
```

### GET /images/:fileName

获取上传的图片

## 🎨 技术栈

- **运行时**: Cloudflare Workers
- **存储**: Cloudflare R2
- **框架**: Hono
- **二维码**: qrcode
- **语言**: TypeScript

## 📝 环境配置

`wrangler.toml` 配置说明:

```toml
name = "qrcode-generator"           # Worker 名称
main = "src/index.ts"               # 入口文件
compatibility_date = "2024-11-01"   # 兼容日期

[[r2_buckets]]
binding = "R2_BUCKET"               # 代码中使用的绑定名
bucket_name = "qrcode-images"       # R2 存储桶名称
```

## 🌍 多语言支持

目前支持以下语言:
- 🇨🇳 简体中文 (zh)
- 🇺🇸 English (en)
- 🇯🇵 日本語 (ja)
- 🇰🇷 한국어 (ko)

语言设置会自动保存到 localStorage。

## 🎯 使用场景

- 快速分享图片给朋友
- 生成产品图片二维码用于线下推广
- 活动现场图片分享
- 任何需要通过二维码分享图片的场景

## 📜 许可证

MIT License

