import { Hono } from 'hono';
import { cors } from 'hono/cors';
import QRCode from 'qrcode-svg';

type Bindings = {
  R2_BUCKET: R2Bucket;
  R2_PUBLIC_URL?: string; // R2 公共访问 URL 基础部分，例如: https://xxx.r2.cloudflarestorage.com/qrcode-images 或 https://your-custom-domain.com
};

const app = new Hono<{ Bindings: Bindings }>();

// Helper function to generate QR code with better error handling
function generateQRCode(text: string, options?: any): string {
  try {
    // Validate input
    if (!text || typeof text !== 'string' || text.length === 0) {
      throw new Error('Invalid text for QR code generation');
    }

    // Create QR code instance
    const qr = new QRCode({
      content: text,
      width: options?.width || 300,
      padding: options?.margin !== undefined ? options.margin * 4 : 8,
      color: options?.color?.dark || '#000000',
      background: options?.color?.light || '#ffffff',
      ecl: options?.errorCorrectionLevel || 'M', // Error correction level: L, M, H, Q
    });

    // Generate SVG string
    const svg = qr.svg();

    if (!svg || typeof svg !== 'string') {
      throw new Error('QR code generation returned invalid SVG');
    }

    // Convert SVG to Data URL
    // Use URL encoding for SVG (more compatible than base64 in some environments)
    // Alternatively, we can use base64 if available
    let dataUrl: string;

    try {
      // Try base64 encoding first (works in most modern environments including Workers)
      if (typeof btoa !== 'undefined') {
        // Use URL encoding to handle UTF-8 characters properly
        const encoded = encodeURIComponent(svg);
        const base64 = btoa(unescape(encoded));
        dataUrl = `data:image/svg+xml;base64,${base64}`;
      } else {
        // Fallback to URL-encoded SVG (works everywhere)
        dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      }
    } catch (e) {
      // Fallback to URL-encoded SVG if base64 fails
      dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    }

    return dataUrl;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('QR Code generation failed:', {
      error: errorMessage,
      text: text.substring(0, 100), // Log first 100 chars of text
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

// CORS middleware
app.use('*', cors());

// Generate unique file name
function generateFileName(originalName: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const ext = originalName.split('.').pop() || 'png';
  return `${timestamp}-${random}.${ext}`;
}

// Get file MIME type
function getMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
    'bmp': 'image/bmp',
  };
  return mimeTypes[ext || ''] || 'application/octet-stream';
}

// Upload image and generate QR code
app.post('/api/upload', async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return c.json({ error: 'Please select an image to upload' }, 400);
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp'];
    if (!allowedTypes.includes(file.type)) {
      return c.json({ error: 'Unsupported file type, please upload an image file' }, 400);
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return c.json({ error: 'File size cannot exceed 10MB' }, 400);
    }

    // Generate file name and upload to R2
    const fileName = generateFileName(file.name);
    const arrayBuffer = await file.arrayBuffer();

    await c.env.R2_BUCKET.put(fileName, arrayBuffer, {
      httpMetadata: {
        contentType: file.type,
      },
    });

    // Build public access URL
    // 优先使用 R2 的直接公共访问链接，如果没有配置则回退到 Workers 代理链接
    let publicUrl: string;
    if (c.env.R2_PUBLIC_URL) {
      // 使用 R2 的直接公共访问链接
      // R2_PUBLIC_URL 应该包含完整的路径前缀，例如: https://xxx.r2.cloudflarestorage.com/qrcode-images
      // 或者自定义域名: https://your-custom-domain.com
      const baseUrl = c.env.R2_PUBLIC_URL.endsWith('/')
        ? c.env.R2_PUBLIC_URL.slice(0, -1)
        : c.env.R2_PUBLIC_URL;
      publicUrl = `${baseUrl}/${fileName}`;
    } else {
      // 回退到 Workers 代理链接
      const url = c.req.url;
      const baseUrl = new URL(url).origin;
      publicUrl = `${baseUrl}/images/${fileName}`;
    }

    // Generate QR code (PNG format Data URL)
    // Wrap QR code generation in try-catch so upload success isn't affected if QR generation fails
    let qrCodeDataUrl: string | null = null;
    try {
      // Validate URL before generating QR code
      if (!publicUrl || publicUrl.length === 0) {
        throw new Error('Invalid public URL for QR code generation');
      }

      // Validate URL format
      try {
        new URL(publicUrl);
      } catch {
        throw new Error(`Invalid URL format: ${publicUrl}`);
      }

      qrCodeDataUrl = generateQRCode(publicUrl, {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
        errorCorrectionLevel: 'M', // Medium error correction
      });

      // Verify QR code was generated successfully
      if (!qrCodeDataUrl || !qrCodeDataUrl.startsWith('data:image')) {
        throw new Error('QR code generation returned invalid data');
      }
    } catch (qrError) {
      // Log detailed error information for debugging
      const errorMessage = qrError instanceof Error ? qrError.message : String(qrError);
      const errorStack = qrError instanceof Error ? qrError.stack : undefined;
      console.error('QR Code generation error:', {
        message: errorMessage,
        stack: errorStack,
        publicUrl: publicUrl,
        fileName: fileName,
      });
      // Continue even if QR code generation fails - file upload was successful
      // But we'll include error info in response for debugging
    }

    return c.json({
      success: true,
      imageUrl: publicUrl,
      qrCode: qrCodeDataUrl,
      fileName: fileName,
      qrCodeGenerated: qrCodeDataUrl !== null,
    });
  } catch (error) {
    console.error('Upload error:', error);
    return c.json({ error: 'Upload failed, please try again' }, 500);
  }
});

// Proxy access to images in R2
app.get('/images/:fileName', async (c) => {
  const fileName = c.req.param('fileName');

  try {
    const object = await c.env.R2_BUCKET.get(fileName);

    if (!object) {
      return c.json({ error: 'Image not found' }, 404);
    }

    const headers = new Headers();
    headers.set('Content-Type', object.httpMetadata?.contentType || getMimeType(fileName));
    headers.set('Cache-Control', 'public, max-age=31536000'); // Cache for one year

    return new Response(object.body, { headers });
  } catch (error) {
    console.error('Get image error:', error);
    return c.json({ error: 'Failed to get image' }, 500);
  }
});

// Generate QR code only (for custom URL)
app.post('/api/qrcode', async (c) => {
  try {
    const body = await c.req.json();
    const { url, size = 300, darkColor = '#000000', lightColor = '#ffffff' } = body;

    if (!url) {
      return c.json({ error: 'Please provide a URL' }, 400);
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      return c.json({ error: 'Invalid URL format' }, 400);
    }

    const qrCodeDataUrl = generateQRCode(url, {
      width: size,
      margin: 2,
      color: {
        dark: darkColor,
        light: lightColor,
      },
      errorCorrectionLevel: 'M', // Medium error correction
    });

    // Verify QR code was generated successfully
    if (!qrCodeDataUrl || !qrCodeDataUrl.startsWith('data:image')) {
      throw new Error('QR code generation returned invalid data');
    }

    return c.json({
      success: true,
      qrCode: qrCodeDataUrl,
    });
  } catch (error) {
    // Log detailed error information for debugging
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('QR Code error:', {
      message: errorMessage,
      stack: errorStack,
    });
    return c.json({
      error: 'Failed to generate QR code',
      details: errorMessage,
    }, 500);
  }
});

// Frontend static page
app.get('/', (c) => {
  return c.html(getHtmlPage());
});

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get frontend HTML page
function getHtmlPage(): string {
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Image QR Code Generator</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      /* Light theme - Warm beige tones */
      --bg-primary: #faf8f5;
      --bg-secondary: #fff;
      --bg-tertiary: #f5f2ed;
      --text-primary: #2d2a26;
      --text-secondary: #6b6560;
      --text-muted: #9c958d;
      --accent: #c75d3a;
      --accent-hover: #b54e2d;
      --accent-light: rgba(199, 93, 58, 0.1);
      --border: #e8e4dd;
      --border-strong: #d4cfc6;
      --shadow-sm: 0 1px 3px rgba(45, 42, 38, 0.06);
      --shadow-md: 0 4px 16px rgba(45, 42, 38, 0.08);
      --shadow-lg: 0 12px 40px rgba(45, 42, 38, 0.12);
      --success: #4a9d5b;
      --error: #c75d3a;
      --radius-sm: 6px;
      --radius-md: 12px;
      --radius-lg: 20px;
      --transition: 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    [data-theme="dark"] {
      /* Dark theme - Deep dark green tones */
      --bg-primary: #0f1612;
      --bg-secondary: #1a211c;
      --bg-tertiary: #242d27;
      --text-primary: #e8ebe9;
      --text-secondary: #a8b0ab;
      --text-muted: #6b7570;
      --accent: #7dd4a3;
      --accent-hover: #9ae3b8;
      --accent-light: rgba(125, 212, 163, 0.12);
      --border: #2e3830;
      --border-strong: #3d4a42;
      --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.2);
      --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.3);
      --shadow-lg: 0 12px 40px rgba(0, 0, 0, 0.4);
      --success: #7dd4a3;
      --error: #e87d6a;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Noto Sans SC', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      min-height: 100vh;
      line-height: 1.6;
      transition: background var(--transition), color var(--transition);
    }

    /* Background texture */
    body::before {
      content: '';
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-image: 
        radial-gradient(circle at 25% 25%, var(--accent-light) 0%, transparent 50%),
        radial-gradient(circle at 75% 75%, var(--accent-light) 0%, transparent 50%);
      pointer-events: none;
      z-index: -1;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 48px 24px;
    }

    /* Main content area for side-by-side layout */
    .main-content {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 32px;
      margin-top: 32px;
    }

    /* When result card is hidden, center the upload area */
    .main-content:has(.result-card:not(.has-result)) {
      grid-template-columns: 1fr;
      justify-items: center;
    }

    .main-content:has(.result-card:not(.has-result)) .upload-card {
      max-width: 600px;
      width: 100%;
    }

    @media (max-width: 960px) {
      .main-content {
        grid-template-columns: 1fr;
        gap: 24px;
      }
    }

    /* Header */
    header {
      text-align: center;
      margin-bottom: 48px;
    }

    .logo {
      font-size: 48px;
      margin-bottom: 16px;
      display: inline-block;
      animation: float 3s ease-in-out infinite;
    }

    @keyframes float {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-8px); }
    }

    h1 {
      font-size: 32px;
      font-weight: 600;
      margin-bottom: 8px;
      letter-spacing: -0.02em;
    }

    .subtitle {
      color: var(--text-secondary);
      font-size: 16px;
      font-weight: 400;
    }

    /* Control bar */
    .controls {
      display: flex;
      justify-content: center;
      gap: 12px;
    }

    .control-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 10px 16px;
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      color: var(--text-secondary);
      font-size: 14px;
      font-family: inherit;
      cursor: pointer;
      transition: all var(--transition);
    }

    .control-btn:hover {
      border-color: var(--border-strong);
      color: var(--text-primary);
      box-shadow: var(--shadow-sm);
    }

    .control-btn.active {
      background: var(--accent-light);
      border-color: var(--accent);
      color: var(--accent);
    }

    .control-icon {
      font-size: 16px;
    }

    /* Language selection dropdown */
    .lang-select {
      position: relative;
    }

    .lang-select select {
      appearance: none;
      padding: 10px 36px 10px 16px;
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      color: var(--text-secondary);
      font-size: 14px;
      font-family: inherit;
      cursor: pointer;
      transition: all var(--transition);
    }

    .lang-select select:hover {
      border-color: var(--border-strong);
      color: var(--text-primary);
    }

    .lang-select::after {
      content: '▾';
      position: absolute;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      pointer-events: none;
      color: var(--text-muted);
      font-size: 12px;
    }

    /* Upload area */
    .upload-card {
      background: var(--bg-secondary);
      border: 2px dashed var(--border);
      border-radius: var(--radius-lg);
      padding: 48px 32px;
      text-align: center;
      transition: all var(--transition);
      cursor: pointer;
      position: relative;
      overflow: hidden;
      min-height: 400px;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }

    .upload-card:hover,
    .upload-card.dragover {
      border-color: var(--accent);
      background: var(--accent-light);
    }

    .upload-card.dragover {
      transform: scale(1.01);
    }

    .upload-card.has-preview {
      padding: 24px;
      border-style: solid;
      border-color: var(--accent);
      background: var(--bg-secondary);
    }

    /* Upload status border colors */
    .upload-card.uploading {
      border-color: #3b82f6;
      border-style: solid;
      animation: borderPulse 2s ease-in-out infinite;
    }

    [data-theme="dark"] .upload-card.uploading {
      border-color: #60a5fa;
      animation: borderPulseDark 2s ease-in-out infinite;
    }

    .upload-card.upload-success {
      border-color: var(--success);
      border-style: solid;
    }

    .upload-card.upload-error {
      border-color: var(--error);
      border-style: solid;
    }

    @keyframes borderPulse {
      0%, 100% {
        border-color: #3b82f6;
      }
      50% {
        border-color: #60a5fa;
      }
    }

    @keyframes borderPulseDark {
      0%, 100% {
        border-color: #60a5fa;
      }
      50% {
        border-color: #93c5fd;
      }
    }

    .upload-preview-container {
      display: none;
      position: relative;
      margin-bottom: 20px;
      border-radius: var(--radius-md);
      overflow: hidden;
      background: var(--bg-tertiary);
      box-shadow: var(--shadow-md);
      border: 1px solid var(--border);
    }

    @keyframes fadeInSlide {
      from {
        opacity: 0;
        transform: translateY(-10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .upload-preview-container.show {
      display: block;
      animation: fadeInScale 0.3s ease;
    }

    @keyframes fadeInScale {
      from {
        opacity: 0;
        transform: scale(0.95);
      }
      to {
        opacity: 1;
        transform: scale(1);
      }
    }

    @keyframes qrCodeAppear {
      from {
        opacity: 0;
        transform: translateY(20px) scale(0.9);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    .upload-preview {
      width: 100%;
      max-height: 450px;
      object-fit: contain;
      display: block;
    }

    .upload-preview-info {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      background: linear-gradient(to top, rgba(0, 0, 0, 0.7), transparent);
      padding: 16px;
      color: #fff;
      display: flex;
      justify-content: space-between;
      align-items: center;
      opacity: 0;
      transition: opacity var(--transition);
    }

    .upload-preview-container:hover .upload-preview-info {
      opacity: 1;
    }

    .upload-preview-name {
      font-size: 14px;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      margin-right: 12px;
    }

    .upload-preview-size {
      font-size: 12px;
      opacity: 0.9;
      font-family: 'JetBrains Mono', monospace;
    }

    .upload-preview-remove {
      position: absolute;
      top: 12px;
      right: 12px;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.6);
      border: none;
      color: #fff;
      font-size: 18px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: all var(--transition);
      z-index: 10;
    }

    .upload-preview-container:hover .upload-preview-remove {
      opacity: 1;
    }

    .upload-preview-remove:hover {
      background: rgba(199, 93, 58, 0.9);
      transform: scale(1.1);
    }

    .upload-content {
      transition: all var(--transition);
    }

    .upload-card.has-preview .upload-content {
      opacity: 0;
      height: 0;
      overflow: hidden;
      margin: 0;
    }

    .upload-icon {
      font-size: 56px;
      margin-bottom: 16px;
      display: block;
    }

    .upload-title {
      font-size: 18px;
      font-weight: 500;
      margin-bottom: 8px;
      color: var(--text-primary);
    }

    .upload-hint {
      color: var(--text-muted);
      font-size: 14px;
    }

    .upload-formats {
      margin-top: 16px;
      display: flex;
      justify-content: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .format-tag {
      padding: 4px 10px;
      background: var(--bg-tertiary);
      border-radius: var(--radius-sm);
      font-size: 12px;
      font-family: 'JetBrains Mono', monospace;
      color: var(--text-muted);
    }

    input[type="file"] {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      opacity: 0;
      cursor: pointer;
    }

    /* Progress bar */
    .progress-bar {
      height: 4px;
      background: var(--bg-tertiary);
      border-radius: 2px;
      margin-top: 24px;
      overflow: hidden;
      display: none;
    }

    .progress-bar.show {
      display: block;
    }

    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--accent), var(--accent-hover));
      border-radius: 2px;
      width: 0%;
      transition: width 0.3s ease;
    }

    .progress-bar.indeterminate .progress-fill {
      width: 30%;
      animation: indeterminate 1.2s infinite ease-in-out;
    }

    @keyframes indeterminate {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(400%); }
    }

    /* Result area */
    .result-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 32px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      min-height: 400px;
      /* Hide entire result card when no QR code */
      opacity: 0;
      max-height: 0;
      min-height: 0;
      padding-top: 0;
      padding-bottom: 0;
      margin: 0;
      overflow: hidden;
      border-width: 0;
      transform: scale(0.95);
    }

    /* Show result card with animation when QR code is generated */
    .result-card.has-result {
      opacity: 1;
      max-height: 1000px;
      min-height: 400px;
      padding-top: 32px;
      padding-bottom: 32px;
      margin: 0;
      border-width: 1px;
      transform: scale(1);
      animation: resultCardAppear 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    /* Hide result content when no QR code */
    .result-card:not(.has-result) .result-content {
      display: none;
    }

    /* Show result content with animation when QR code is generated */
    .result-card.has-result .result-content {
      display: flex;
      animation: qrCodeAppear 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.2s both;
    }

    .result-card.has-result .btn-group {
      display: flex;
      animation: qrCodeAppear 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.4s both;
    }

    @keyframes resultCardAppear {
      from {
        opacity: 0;
        max-height: 0;
        min-height: 0;
        padding-top: 0;
        padding-bottom: 0;
        border-width: 0;
        transform: translateY(20px) scale(0.95);
      }
      to {
        opacity: 1;
        max-height: 1000px;
        min-height: 400px;
        padding-top: 32px;
        padding-bottom: 32px;
        border-width: 1px;
        transform: translateY(0) scale(1);
      }
    }

    @keyframes slideUp {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }


    .result-content {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      gap: 24px;
      flex: 1;
      width: 100%;
    }

    .result-section {
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .result-label {
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .qr-image {
      width: 320px;
      height: 320px;
      border-radius: var(--radius-md);
      background: #fff;
      padding: 16px;
      box-shadow: var(--shadow-md);
      transition: transform var(--transition);
    }

    .qr-image:hover {
      transform: scale(1.05);
    }

    /* Buttons */
    .btn-group {
      display: flex;
      gap: 12px;
      margin-top: 24px;
      justify-content: center;
      width: 100%;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 12px 24px;
      border: none;
      border-radius: var(--radius-sm);
      font-size: 14px;
      font-weight: 500;
      font-family: inherit;
      cursor: pointer;
      transition: all var(--transition);
      text-decoration: none;
    }

    .btn-primary {
      background: var(--accent);
      color: #fff;
    }

    .btn-primary:hover {
      background: var(--accent-hover);
      transform: translateY(-1px);
      box-shadow: var(--shadow-md);
    }

    .btn-secondary {
      background: var(--bg-tertiary);
      color: var(--text-primary);
      border: 1px solid var(--border);
    }

    .btn-secondary:hover {
      border-color: var(--border-strong);
      box-shadow: var(--shadow-sm);
    }

    /* Toast message */
    .toast {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%) translateY(100px);
      padding: 14px 24px;
      background: var(--text-primary);
      color: var(--bg-primary);
      border-radius: var(--radius-sm);
      font-size: 14px;
      box-shadow: var(--shadow-lg);
      opacity: 0;
      transition: all 0.3s ease;
      z-index: 1000;
    }

    .toast.show {
      transform: translateX(-50%) translateY(0);
      opacity: 1;
    }

    .toast.error {
      background: var(--error);
      color: #fff;
    }

    /* Footer */
    footer {
      text-align: center;
      margin-top: 64px;
      padding-top: 24px;
      border-top: 1px solid var(--border);
      color: var(--text-muted);
      font-size: 13px;
    }

    footer .controls {
      margin-bottom: 0;
    }

    footer a {
      color: var(--text-secondary);
      text-decoration: none;
      transition: color var(--transition);
    }

    footer a:hover {
      color: var(--accent);
    }

    /* Responsive design for preview */
    @media (max-width: 960px) {
      .upload-card {
        min-height: auto;
      }

      .result-card.has-result {
        min-height: auto;
      }

      .qr-image {
        width: 280px;
        height: 280px;
      }
    }

    @media (max-width: 640px) {
      .container {
        padding: 32px 16px;
      }

      .main-content {
        gap: 20px;
      }

      .upload-card {
        padding: 32px 20px;
      }

      .result-card.has-result {
        padding: 24px 20px;
        min-height: auto;
      }

      .upload-preview {
        max-height: 300px;
      }

      .upload-preview-info {
        padding: 12px;
        font-size: 12px;
      }

      .upload-preview-name {
        font-size: 13px;
      }

      .upload-preview-size {
        font-size: 11px;
      }

      .upload-preview-remove {
        width: 28px;
        height: 28px;
        font-size: 16px;
        top: 8px;
        right: 8px;
      }

      .upload-card.has-preview {
        padding: 16px;
      }

      .qr-image {
        width: 240px;
        height: 240px;
        padding: 12px;
      }
    }

    /* Ensure preview container doesn't interfere with file input */
    .upload-preview-container {
      pointer-events: none;
    }

    .upload-preview-container .upload-preview-remove {
      pointer-events: auto;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <span class="logo">📸</span>
      <h1 data-i18n="title">Image QR Code Generator</h1>
      <p class="subtitle" data-i18n="subtitle">Upload an image and generate a shareable QR code instantly</p>
    </header>

    <div class="main-content">
      <div class="upload-card" id="uploadCard">
        <div class="upload-preview-container" id="uploadPreviewContainer">
          <img class="upload-preview" id="uploadPreview" alt="Preview">
          <button class="upload-preview-remove" id="previewRemove" title="Remove preview">×</button>
          <div class="upload-preview-info">
            <span class="upload-preview-name" id="previewFileName"></span>
            <span class="upload-preview-size" id="previewFileSize"></span>
          </div>
        </div>
        <div class="upload-content">
          <span class="upload-icon">📤</span>
          <h2 class="upload-title" data-i18n="uploadTitle">Click or drag to upload image</h2>
          <p class="upload-hint" data-i18n="uploadHint">Supports JPG, PNG, GIF, WebP, max 10MB</p>
          <div class="upload-formats">
            <span class="format-tag">JPG</span>
            <span class="format-tag">PNG</span>
            <span class="format-tag">GIF</span>
            <span class="format-tag">WebP</span>
          </div>
        </div>
        <input type="file" id="fileInput" accept="image/*">
        <div class="progress-bar" id="progressBar">
          <div class="progress-fill" id="progressFill"></div>
        </div>
      </div>

      <div class="result-card" id="resultCard">
        <div class="result-content">
          <div class="result-section">
            <div class="result-label" data-i18n="qrcode">QR Code</div>
            <img class="qr-image" id="qrImage" alt="QR Code">
          </div>
        </div>
        <div class="btn-group">
          <button class="btn btn-primary" id="downloadQr">
            <span>⬇</span>
            <span data-i18n="downloadQr">Download QR</span>
          </button>
        </div>
      </div>
    </div>

    <footer>
      <div class="controls">
        <button class="control-btn" id="themeToggle" title="Toggle theme">
          <span class="control-icon" id="themeIcon">🌙</span>
          <span data-i18n="theme">Theme</span>
        </button>
        <div class="lang-select">
          <select id="langSelect">
            <option value="en">English</option>
            <option value="zh">简体中文</option>
            <option value="ja">日本語</option>
            <option value="ko">한국어</option>
          </select>
        </div>
      </div>
    </footer>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    // Store current uploaded file info
    let currentFileName = null;
    let currentOriginalFileName = null;

    // Multi-language support
    const i18n = {
      en: {
        title: 'Image QR Code Generator',
        subtitle: 'Upload an image and generate a shareable QR code instantly',
        theme: 'Theme',
        uploadTitle: 'Click or drag to upload image',
        uploadHint: 'Supports JPG, PNG, GIF, WebP, max 10MB',
        uploadSuccess: 'Upload successful',
        preview: 'Preview',
        qrcode: 'QR Code',
        imageUrl: 'Image URL',
        downloadQr: 'Download QR',
        copyUrl: 'Copy URL',
        uploadAnother: 'Upload Another',
        uploading: 'Uploading...',
        copySuccess: 'Link copied to clipboard',
        copyError: 'Copy failed, please copy manually',
        uploadError: 'Upload failed, please try again',
        qrGenerationFailed: 'QR code generation failed, but image uploaded successfully',
        placeholderText: 'QR code will appear here',
        placeholderHint: 'Upload an image to generate QR code',
        downloadError: 'Download failed, trying to download as SVG format',
      },
      zh: {
        title: '图片二维码生成器',
        subtitle: '上传图片，即刻生成可分享的二维码',
        theme: '主题',
        uploadTitle: '点击或拖拽上传图片',
        uploadHint: '支持 JPG、PNG、GIF、WebP 等格式，最大 10MB',
        uploadSuccess: '上传成功',
        preview: '预览',
        qrcode: '二维码',
        imageUrl: '图片链接',
        downloadQr: '下载二维码',
        copyUrl: '复制链接',
        uploadAnother: '再传一张',
        uploading: '上传中...',
        copySuccess: '链接已复制到剪贴板',
        copyError: '复制失败，请手动复制',
        uploadError: '上传失败，请重试',
        qrGenerationFailed: '二维码生成失败，但图片已成功上传',
        placeholderText: '上传图片后，二维码将显示在这里',
        placeholderHint: 'Upload an image to generate QR code',
        downloadError: '下载失败，已尝试下载为SVG格式',
      },
      ja: {
        title: '画像QRコード生成',
        subtitle: '画像をアップロードして、共有可能なQRコードを即座に生成',
        theme: 'テーマ',
        uploadTitle: 'クリックまたはドラッグして画像をアップロード',
        uploadHint: 'JPG、PNG、GIF、WebP対応、最大10MB',
        uploadSuccess: 'アップロード成功',
        preview: 'プレビュー',
        qrcode: 'QRコード',
        imageUrl: '画像URL',
        downloadQr: 'QRコードをダウンロード',
        copyUrl: 'URLをコピー',
        uploadAnother: '別の画像をアップロード',
        uploading: 'アップロード中...',
        copySuccess: 'リンクをクリップボードにコピーしました',
        copyError: 'コピーに失敗しました',
        uploadError: 'アップロードに失敗しました',
        qrGenerationFailed: 'QRコードの生成に失敗しましたが、画像のアップロードは成功しました',
        placeholderText: '画像をアップロードすると、QRコードがここに表示されます',
        placeholderHint: 'Upload an image to generate QR code',
        downloadError: 'ダウンロードに失敗しました。SVG形式でダウンロードを試みます',
      },
      ko: {
        title: '이미지 QR코드 생성기',
        subtitle: '이미지를 업로드하고 공유 가능한 QR코드를 즉시 생성하세요',
        theme: '테마',
        uploadTitle: '클릭하거나 드래그하여 이미지 업로드',
        uploadHint: 'JPG, PNG, GIF, WebP 지원, 최대 10MB',
        uploadSuccess: '업로드 성공',
        preview: '미리보기',
        qrcode: 'QR코드',
        imageUrl: '이미지 URL',
        downloadQr: 'QR코드 다운로드',
        copyUrl: 'URL 복사',
        uploadAnother: '다른 이미지 업로드',
        uploading: '업로드 중...',
        copySuccess: '링크가 클립보드에 복사되었습니다',
        copyError: '복사 실패',
        uploadError: '업로드 실패, 다시 시도해 주세요',
        qrGenerationFailed: 'QR코드 생성 실패, 하지만 이미지 업로드는 성공했습니다',
        placeholderText: '이미지를 업로드하면 QR코드가 여기에 표시됩니다',
        placeholderHint: 'Upload an image to generate QR code',
        downloadError: '다운로드 실패, SVG 형식으로 다운로드를 시도합니다',
      },
    };

    // Detect browser language
    function detectBrowserLanguage() {
      const browserLang = navigator.language || navigator.languages?.[0] || 'en';
      const langCode = browserLang.toLowerCase().split('-')[0];
      
      // Map browser language to supported languages
      const langMap = {
        'zh': 'zh',
        'ja': 'ja',
        'ko': 'ko',
        'en': 'en',
      };
      
      return langMap[langCode] || 'en';
    }

    // Detect system theme preference
    function detectSystemTheme() {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
      return 'light';
    }

    // Get initial language (prefer saved, fallback to browser)
    let currentLang = localStorage.getItem('lang');
    if (!currentLang) {
      currentLang = detectBrowserLanguage();
      localStorage.setItem('lang', currentLang);
    }

    // Get initial theme (prefer manual setting, fallback to system)
    const isThemeManual = localStorage.getItem('theme-manual') === 'true';
    let currentTheme;
    if (isThemeManual) {
      // User has manually set theme, use saved value
      currentTheme = localStorage.getItem('theme') || 'light';
    } else {
      // Auto-detect from system, don't save to localStorage
      currentTheme = detectSystemTheme();
    }

    // Initialize
    function init() {
      // Set theme
      document.documentElement.setAttribute('data-theme', currentTheme);
      updateThemeIcon();

      // Set language
      document.getElementById('langSelect').value = currentLang;
      updateLanguage();

      // Listen for system theme changes (only if user hasn't manually set theme)
      if (!isThemeManual) {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handleThemeChange = (e) => {
          // Only update if user hasn't manually set theme
          if (localStorage.getItem('theme-manual') !== 'true') {
            currentTheme = e.matches ? 'dark' : 'light';
            document.documentElement.setAttribute('data-theme', currentTheme);
            updateThemeIcon();
            // Don't save to localStorage to keep it auto-following system
          }
        };
        
        // Modern browsers
        if (mediaQuery.addEventListener) {
          mediaQuery.addEventListener('change', handleThemeChange);
        } else {
          // Fallback for older browsers
          mediaQuery.addListener(handleThemeChange);
        }
      }

      // Bind events
      bindEvents();
    }

    // Update language
    function updateLanguage() {
      const texts = i18n[currentLang];
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (texts[key]) {
          el.textContent = texts[key];
        }
      });
      document.documentElement.lang = currentLang === 'zh' ? 'zh-CN' : currentLang;
    }

    // Update theme icon
    function updateThemeIcon() {
      const icon = document.getElementById('themeIcon');
      icon.textContent = currentTheme === 'dark' ? '☀️' : '🌙';
    }

    // Show Toast
    function showToast(message, isError = false) {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.className = 'toast' + (isError ? ' error' : '');
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 3000);
    }

    // Bind events
    function bindEvents() {
      const uploadCard = document.getElementById('uploadCard');
      const fileInput = document.getElementById('fileInput');
      const themeToggle = document.getElementById('themeToggle');
      const langSelect = document.getElementById('langSelect');
      const downloadQr = document.getElementById('downloadQr');

      // Theme toggle
      themeToggle.addEventListener('click', () => {
        currentTheme = currentTheme === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', currentTheme);
        localStorage.setItem('theme', currentTheme);
        updateThemeIcon();
        // Mark that user has manually set theme (stop auto-detection)
        localStorage.setItem('theme-manual', 'true');
      });

      // Language switch
      langSelect.addEventListener('change', (e) => {
        currentLang = e.target.value;
        localStorage.setItem('lang', currentLang);
        updateLanguage();
      });

      // Drag and drop upload
      uploadCard.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadCard.classList.add('dragover');
      });

      uploadCard.addEventListener('dragleave', () => {
        uploadCard.classList.remove('dragover');
      });

      uploadCard.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadCard.classList.remove('dragover');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
          handleFile(files[0]);
        }
      });

      // File selection
      fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
          handleFile(e.target.files[0]);
        }
      });

      // Download QR code
      downloadQr.addEventListener('click', async () => {
        const qrImage = document.getElementById('qrImage');
        const src = qrImage.src;
        
        try {
          // Check if it's an SVG data URL
          if (src.startsWith('data:image/svg+xml')) {
            // Convert SVG to PNG using Canvas
            const img = new Image();
            img.crossOrigin = 'anonymous';
            
            await new Promise((resolve, reject) => {
              img.onload = resolve;
              img.onerror = reject;
              img.src = src;
            });
            
            // Create canvas and draw image
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            // Get image dimensions (use natural dimensions for better quality)
            const imgWidth = img.naturalWidth || img.width || 300;
            const imgHeight = img.naturalHeight || img.height || 300;
            canvas.width = imgWidth;
            canvas.height = imgHeight;
            
            // Draw white background first (for SVG transparency)
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Draw the QR code image
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            
            // Convert canvas to PNG blob and download
            canvas.toBlob((blob) => {
              if (blob) {
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.download = generateDownloadFileName('png');
                link.href = url;
                link.click();
                // Clean up
                setTimeout(() => URL.revokeObjectURL(url), 100);
              } else {
                // Fallback: download as SVG
                const link = document.createElement('a');
                link.download = generateDownloadFileName('svg');
                link.href = src;
                link.click();
              }
            }, 'image/png');
          } else {
            // If it's already a PNG or other format, download directly
            const link = document.createElement('a');
            link.download = generateDownloadFileName('png');
            link.href = src;
            link.click();
          }
        } catch (error) {
          console.error('Download error:', error);
          // Fallback: try to download as SVG
          const link = document.createElement('a');
          link.download = generateDownloadFileName('svg');
          link.href = src;
          link.click();
          showToast(i18n[currentLang].downloadError || '下载失败，已尝试下载为SVG格式', false);
        }
      });

      // Preview remove button
      const previewRemove = document.getElementById('previewRemove');
      previewRemove.addEventListener('click', (e) => {
        e.stopPropagation();
        resetPreview();
      });
    }

    // Format file size
    function formatFileSize(bytes) {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }

    // Reset preview
    function resetPreview() {
      const uploadCard = document.getElementById('uploadCard');
      const uploadPreviewContainer = document.getElementById('uploadPreviewContainer');
      const uploadPreview = document.getElementById('uploadPreview');
      const fileInput = document.getElementById('fileInput');
      const resultCard = document.getElementById('resultCard');
      
      uploadCard.classList.remove('has-preview', 'upload-success', 'upload-error', 'uploading');
      uploadPreviewContainer.classList.remove('show');
      uploadPreview.src = '';
      fileInput.value = '';
      
      // Reset file name info
      currentFileName = null;
      currentOriginalFileName = null;
      
      // Reset result card to placeholder state
      resultCard.classList.remove('has-result');
    }

    // Generate download file name
    function generateDownloadFileName(extension) {
      extension = extension || 'png';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      return 'qrcode-' + timestamp + '.' + extension;
    }

    // Show preview
    function showPreview(file) {
      const uploadCard = document.getElementById('uploadCard');
      const uploadPreviewContainer = document.getElementById('uploadPreviewContainer');
      const uploadPreview = document.getElementById('uploadPreview');
      const previewFileName = document.getElementById('previewFileName');
      const previewFileSize = document.getElementById('previewFileSize');

      // Show file info
      previewFileName.textContent = file.name;
      previewFileSize.textContent = formatFileSize(file.size);

      // Show preview image
      const reader = new FileReader();
      reader.onload = (e) => {
        uploadPreview.src = e.target.result;
        uploadPreviewContainer.classList.add('show');
        uploadCard.classList.add('has-preview');
      };
      reader.readAsDataURL(file);
    }

    // Handle file upload
    async function handleFile(file) {
      const progressBar = document.getElementById('progressBar');
      const resultCard = document.getElementById('resultCard');
      const uploadCard = document.getElementById('uploadCard');

      // Save original file name
      currentOriginalFileName = file.name;

      // Show preview immediately
      showPreview(file);

      // Set uploading state
      uploadCard.classList.remove('upload-success', 'upload-error');
      uploadCard.classList.add('uploading');

      // Show progress bar
      progressBar.classList.add('show', 'indeterminate');
      resultCard.classList.remove('has-result');

      const formData = new FormData();
      formData.append('file', file);

      try {
        const response = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || i18n[currentLang].uploadError);
        }

        // Save uploaded file name
        currentFileName = data.fileName || null;

        // Show result
        if (data.qrCode) {
          document.getElementById('qrImage').src = data.qrCode;
        } else {
          // If QR code generation failed, show error message or placeholder
          const qrImage = document.getElementById('qrImage');
          qrImage.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTgwIiBoZWlnaHQ9IjE4MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjBmMGYwIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzk5OTkiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj5RUkNvZGUgR2VuZXJhdGlvbiBGYWlsZWQ8L3RleHQ+PC9zdmc+';
          // Show warning toast that QR generation failed but upload succeeded
          showToast(i18n[currentLang].qrGenerationFailed, false);
        }

        // Set upload success state
        uploadCard.classList.remove('uploading', 'upload-error');
        uploadCard.classList.add('upload-success');

        progressBar.classList.remove('show', 'indeterminate');
        resultCard.classList.add('has-result');

      } catch (error) {
        // Set upload error state
        uploadCard.classList.remove('uploading', 'upload-success');
        uploadCard.classList.add('upload-error');

        progressBar.classList.remove('show', 'indeterminate');
        showToast(error.message || i18n[currentLang].uploadError, true);
      }
    }

    // Start application
    init();
  </script>
</body>
</html>`;
}

export default app;

