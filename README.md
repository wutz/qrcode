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

#### Method 1: Create via Cloudflare Dashboard

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Select your account
3. Navigate to **R2** or **Workers & Pages** > **R2** in the left menu
4. Click the **Create bucket** button
5. Enter bucket name: `qrcode-images`
6. Select location (optional, recommended to choose the region closest to you)
7. Click **Create bucket** to complete

#### Method 2: Create via Wrangler CLI

```bash
# Log in to Cloudflare (if not already logged in)
npx wrangler login

# Create R2 bucket
npx wrangler r2 bucket create qrcode-images
```

#### Configure R2 Bucket Access

**Important**: By default, R2 buckets are private. You need to configure access:

**Option 1: Access via Workers Proxy (Recommended, used by this project)**
- No additional configuration needed, the code already implements proxy access via `/images/:fileName` route
- This approach is more secure and allows access control

**Option 2: Configure Public Access (Not recommended for production)**
- In Cloudflare Dashboard, go to R2 > your bucket
- Click **Settings** > **Public Access**
- Configure custom domain or use Cloudflare's public URL
- ⚠️ Note: Public access will incur traffic fees
- After configuring public access, set the `R2_PUBLIC_URL` secret to use direct R2 links for QR codes:
  ```bash
  wrangler secret put R2_PUBLIC_URL
  # Enter the public URL, e.g.: https://xxx.r2.cloudflarestorage.com/qrcode-images
  # Or custom domain: https://your-custom-domain.com
  ```

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

### R2 Bucket Configuration

#### 1. wrangler.toml Configuration

Configure R2 bucket binding in the `wrangler.toml` file:

```toml
name = "qrcode-generator"           # Worker name
main = "src/index.ts"               # Entry file
compatibility_date = "2024-11-01"   # Compatibility date

# R2 Bucket Configuration
[[r2_buckets]]
binding = "R2_BUCKET"               # Binding name used in code
bucket_name = "qrcode-images"      # R2 bucket name (must match the bucket name created in Dashboard)
```

**Configuration Notes**:
- `binding`: Variable name accessed via `c.env.R2_BUCKET` in Worker code
- `bucket_name`: Actual name of the R2 bucket created in Cloudflare Dashboard
- You can configure multiple R2 buckets, each bucket requires a separate `[[r2_buckets]]` configuration block

#### 2. Using R2 Bucket in Code

In TypeScript code, R2 bucket is accessed through environment bindings:

```typescript
type Bindings = {
    R2_BUCKET: R2Bucket;  // Type definition
};

// Upload file to R2
await c.env.R2_BUCKET.put(fileName, arrayBuffer, {
    httpMetadata: {
        contentType: file.type,
    },
});

// Read file from R2
const object = await c.env.R2_BUCKET.get(fileName);
```

#### 3. Local Development Configuration

**Using Local R2 Emulator** (Recommended for development):

Wrangler automatically uses the local emulator, no additional configuration needed. Running `npm run dev` will automatically start the local R2 emulator.

**Connecting to Remote R2 Bucket**:

If you want to connect to a real R2 bucket during local development, ensure:
1. You have logged in via `npx wrangler login`
2. The corresponding bucket has been created in Cloudflare Dashboard
3. The bucket name matches the `bucket_name` in `wrangler.toml`

#### 4. Deployment Configuration

Pre-deployment Checklist:
- ✅ R2 bucket created in Cloudflare Dashboard
- ✅ `bucket_name` in `wrangler.toml` matches the name in Dashboard
- ✅ Logged in to Cloudflare account via `npx wrangler login`
- ✅ Worker has permission to access R2 bucket (automatically authorized on first deployment)

Deployment command:
```bash
npm run deploy
```

#### 5. Multi-Environment Configuration

If you need to use different buckets for different environments (development, production):

```toml
# Development environment
[env.development]
[[env.development.r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "qrcode-images-dev"

# Production environment
[env.production]
[[env.production.r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "qrcode-images"
```

Deploy to specific environment:
```bash
# Deploy to development environment
npx wrangler deploy --env development

# Deploy to production environment
npx wrangler deploy --env production
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
