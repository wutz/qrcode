# 📸 Image QR Code Generator

Image upload and QR code generation service based on Cloudflare Workers + R2.

## ✨ Features

- 🖼️ **Image Upload** - Supports common formats like JPG, PNG, GIF, WebP
- 📱 **QR Code Generation** - Automatically generates QR codes for image links
- 🌐 **Multi-language Support** - Chinese, English, Japanese, Korean
- 🎨 **Theme Toggle** - Light/Dark dual themes
- ⚡ **Fast Response** - Deployed on Cloudflare's global edge network
- 💰 **Low Cost** - R2 has no egress fees

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Cloudflare account
- Wrangler CLI

### Install Dependencies

```bash
npm install
```

### Create R2 Bucket

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Go to R2 Storage
3. Create a bucket named `qrcode-images`

### Local Development

```bash
npm run dev
```

Visit http://localhost:8787

### Deploy to Cloudflare

```bash
npm run deploy
```

## 📁 Project Structure

```
qrcode/
├── src/
│   └── index.ts      # Worker main file (API + Frontend)
├── package.json      # Dependencies configuration
├── wrangler.toml     # Cloudflare configuration
├── tsconfig.json     # TypeScript configuration
└── README.md         # Project documentation
```

## 🔧 API Endpoints

### POST /api/upload

Upload an image and generate a QR code

**Request**: `multipart/form-data`
- `file`: Image file

**Response**:
```json
{
  "success": true,
  "imageUrl": "https://your-worker.workers.dev/images/xxx.png",
  "qrCode": "data:image/png;base64,xxx",
  "fileName": "xxx.png"
}
```

### POST /api/qrcode

Generate a QR code for a custom URL

**Request**: `application/json`
```json
{
  "url": "https://example.com",
  "size": 300,
  "darkColor": "#000000",
  "lightColor": "#ffffff"
}
```

### GET /images/:fileName

Get uploaded image

## 🎨 Tech Stack

- **Runtime**: Cloudflare Workers
- **Storage**: Cloudflare R2
- **Framework**: Hono
- **QR Code**: qrcode
- **Language**: TypeScript

## 📝 Environment Configuration

`wrangler.toml` configuration:

```toml
name = "qrcode-generator"           # Worker name
main = "src/index.ts"               # Entry file
compatibility_date = "2024-11-01"   # Compatibility date

[[r2_buckets]]
binding = "R2_BUCKET"               # Binding name used in code
bucket_name = "qrcode-images"      # R2 bucket name
```

## 🌍 Multi-language Support

Currently supports the following languages:
- 🇨🇳 Simplified Chinese (zh)
- 🇺🇸 English (en)
- 🇯🇵 Japanese (ja)
- 🇰🇷 Korean (ko)

Language settings are automatically saved to localStorage.

## 🎯 Use Cases

- Quickly share images with friends
- Generate product image QR codes for offline promotion
- Event photo sharing
- Any scenario that requires sharing images via QR codes

## 📜 License

MIT License
