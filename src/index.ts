import { Hono } from 'hono';
import { cors } from 'hono/cors';
import QRCode from 'qrcode';

type Bindings = {
  R2_BUCKET: R2Bucket;
};

const app = new Hono<{ Bindings: Bindings }>();

// CORS 中间件
app.use('*', cors());

// 生成唯一文件名
function generateFileName(originalName: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const ext = originalName.split('.').pop() || 'png';
  return `${timestamp}-${random}.${ext}`;
}

// 获取文件的 MIME 类型
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

// 上传图片并生成二维码
app.post('/api/upload', async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return c.json({ error: '请选择要上传的图片' }, 400);
    }

    // 验证文件类型
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp'];
    if (!allowedTypes.includes(file.type)) {
      return c.json({ error: '不支持的文件类型，请上传图片文件' }, 400);
    }

    // 验证文件大小 (最大 10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return c.json({ error: '文件大小不能超过 10MB' }, 400);
    }

    // 生成文件名并上传到 R2
    const fileName = generateFileName(file.name);
    const arrayBuffer = await file.arrayBuffer();

    await c.env.R2_BUCKET.put(fileName, arrayBuffer, {
      httpMetadata: {
        contentType: file.type,
      },
    });

    // 构建公共访问 URL
    // 注意：需要在 Cloudflare Dashboard 中为 R2 存储桶配置公共访问
    // 或者使用 Workers 来代理访问
    const url = c.req.url;
    const baseUrl = new URL(url).origin;
    const publicUrl = `${baseUrl}/images/${fileName}`;

    // 生成二维码 (PNG 格式的 Data URL)
    const qrCodeDataUrl = await QRCode.toDataURL(publicUrl, {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    });

    return c.json({
      success: true,
      imageUrl: publicUrl,
      qrCode: qrCodeDataUrl,
      fileName: fileName,
    });
  } catch (error) {
    console.error('Upload error:', error);
    return c.json({ error: '上传失败，请重试' }, 500);
  }
});

// 代理访问 R2 中的图片
app.get('/images/:fileName', async (c) => {
  const fileName = c.req.param('fileName');

  try {
    const object = await c.env.R2_BUCKET.get(fileName);

    if (!object) {
      return c.json({ error: '图片不存在' }, 404);
    }

    const headers = new Headers();
    headers.set('Content-Type', object.httpMetadata?.contentType || getMimeType(fileName));
    headers.set('Cache-Control', 'public, max-age=31536000'); // 缓存一年

    return new Response(object.body, { headers });
  } catch (error) {
    console.error('Get image error:', error);
    return c.json({ error: '获取图片失败' }, 500);
  }
});

// 仅生成二维码 (用于自定义 URL)
app.post('/api/qrcode', async (c) => {
  try {
    const body = await c.req.json();
    const { url, size = 300, darkColor = '#000000', lightColor = '#ffffff' } = body;

    if (!url) {
      return c.json({ error: '请提供 URL' }, 400);
    }

    const qrCodeDataUrl = await QRCode.toDataURL(url, {
      width: size,
      margin: 2,
      color: {
        dark: darkColor,
        light: lightColor,
      },
    });

    return c.json({
      success: true,
      qrCode: qrCodeDataUrl,
    });
  } catch (error) {
    console.error('QR Code error:', error);
    return c.json({ error: '生成二维码失败' }, 500);
  }
});

// 前端静态页面
app.get('/', (c) => {
  return c.html(getHtmlPage());
});

// 健康检查
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 获取前端 HTML 页面
function getHtmlPage(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>图片二维码生成器</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      /* 亮色主题 - 温暖米色调 */
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
      /* 暗色主题 - 深邃墨绿调 */
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

    /* 背景纹理 */
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
      max-width: 680px;
      margin: 0 auto;
      padding: 48px 24px;
    }

    /* 头部 */
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

    /* 控制栏 */
    .controls {
      display: flex;
      justify-content: center;
      gap: 12px;
      margin-bottom: 40px;
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

    /* 语言选择下拉 */
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

    /* 上传区域 */
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
    }

    .upload-card:hover,
    .upload-card.dragover {
      border-color: var(--accent);
      background: var(--accent-light);
    }

    .upload-card.dragover {
      transform: scale(1.01);
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

    /* 进度条 */
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

    /* 结果区域 */
    .result-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 32px;
      margin-top: 24px;
      display: none;
      animation: slideUp 0.4s ease;
    }

    .result-card.show {
      display: block;
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

    .result-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
    }

    .success-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      background: rgba(74, 157, 91, 0.1);
      border-radius: var(--radius-sm);
      color: var(--success);
      font-size: 14px;
      font-weight: 500;
    }

    .result-content {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
    }

    @media (max-width: 560px) {
      .result-content {
        grid-template-columns: 1fr;
      }
    }

    .result-section {
      text-align: center;
    }

    .result-label {
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .preview-image {
      width: 100%;
      max-width: 200px;
      height: auto;
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-md);
    }

    .qr-image {
      width: 180px;
      height: 180px;
      border-radius: var(--radius-md);
      background: #fff;
      padding: 12px;
      box-shadow: var(--shadow-md);
    }

    /* URL 显示 */
    .url-display {
      margin-top: 24px;
      padding: 16px;
      background: var(--bg-tertiary);
      border-radius: var(--radius-md);
    }

    .url-label {
      font-size: 12px;
      color: var(--text-muted);
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .url-text {
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      color: var(--text-secondary);
      word-break: break-all;
      line-height: 1.5;
    }

    /* 按钮 */
    .btn-group {
      display: flex;
      gap: 12px;
      margin-top: 24px;
      justify-content: center;
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

    /* Toast 消息 */
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

    /* 页脚 */
    footer {
      text-align: center;
      margin-top: 64px;
      padding-top: 24px;
      border-top: 1px solid var(--border);
      color: var(--text-muted);
      font-size: 13px;
    }

    footer a {
      color: var(--text-secondary);
      text-decoration: none;
      transition: color var(--transition);
    }

    footer a:hover {
      color: var(--accent);
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <span class="logo">📸</span>
      <h1 data-i18n="title">图片二维码生成器</h1>
      <p class="subtitle" data-i18n="subtitle">上传图片，即刻生成可分享的二维码</p>
    </header>

    <div class="controls">
      <button class="control-btn" id="themeToggle" title="切换主题">
        <span class="control-icon" id="themeIcon">🌙</span>
        <span data-i18n="theme">主题</span>
      </button>
      <div class="lang-select">
        <select id="langSelect">
          <option value="zh">简体中文</option>
          <option value="en">English</option>
          <option value="ja">日本語</option>
          <option value="ko">한국어</option>
        </select>
      </div>
    </div>

    <div class="upload-card" id="uploadCard">
      <span class="upload-icon">📤</span>
      <h2 class="upload-title" data-i18n="uploadTitle">点击或拖拽上传图片</h2>
      <p class="upload-hint" data-i18n="uploadHint">支持 JPG、PNG、GIF、WebP 等格式，最大 10MB</p>
      <div class="upload-formats">
        <span class="format-tag">JPG</span>
        <span class="format-tag">PNG</span>
        <span class="format-tag">GIF</span>
        <span class="format-tag">WebP</span>
      </div>
      <input type="file" id="fileInput" accept="image/*">
      <div class="progress-bar" id="progressBar">
        <div class="progress-fill" id="progressFill"></div>
      </div>
    </div>

    <div class="result-card" id="resultCard">
      <div class="result-header">
        <span class="success-badge">
          <span>✓</span>
          <span data-i18n="uploadSuccess">上传成功</span>
        </span>
      </div>
      <div class="result-content">
        <div class="result-section">
          <div class="result-label" data-i18n="preview">预览</div>
          <img class="preview-image" id="previewImage" alt="Preview">
        </div>
        <div class="result-section">
          <div class="result-label" data-i18n="qrcode">二维码</div>
          <img class="qr-image" id="qrImage" alt="QR Code">
        </div>
      </div>
      <div class="url-display">
        <div class="url-label" data-i18n="imageUrl">图片链接</div>
        <div class="url-text" id="imageUrl"></div>
      </div>
      <div class="btn-group">
        <button class="btn btn-primary" id="downloadQr">
          <span>⬇</span>
          <span data-i18n="downloadQr">下载二维码</span>
        </button>
        <button class="btn btn-secondary" id="copyUrl">
          <span>📋</span>
          <span data-i18n="copyUrl">复制链接</span>
        </button>
        <button class="btn btn-secondary" id="uploadAnother">
          <span>🔄</span>
          <span data-i18n="uploadAnother">再传一张</span>
        </button>
      </div>
    </div>

    <footer>
      <p data-i18n="footer">基于 Cloudflare Workers + R2 构建</p>
    </footer>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    // 多语言支持
    const i18n = {
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
        footer: '基于 Cloudflare Workers + R2 构建',
        uploading: '上传中...',
        copySuccess: '链接已复制到剪贴板',
        copyError: '复制失败，请手动复制',
        uploadError: '上传失败，请重试',
      },
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
        footer: 'Built with Cloudflare Workers + R2',
        uploading: 'Uploading...',
        copySuccess: 'Link copied to clipboard',
        copyError: 'Copy failed, please copy manually',
        uploadError: 'Upload failed, please try again',
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
        footer: 'Cloudflare Workers + R2で構築',
        uploading: 'アップロード中...',
        copySuccess: 'リンクをクリップボードにコピーしました',
        copyError: 'コピーに失敗しました',
        uploadError: 'アップロードに失敗しました',
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
        footer: 'Cloudflare Workers + R2로 구축',
        uploading: '업로드 중...',
        copySuccess: '링크가 클립보드에 복사되었습니다',
        copyError: '복사 실패',
        uploadError: '업로드 실패, 다시 시도해 주세요',
      },
    };

    let currentLang = localStorage.getItem('lang') || 'zh';
    let currentTheme = localStorage.getItem('theme') || 'light';

    // 初始化
    function init() {
      // 设置主题
      document.documentElement.setAttribute('data-theme', currentTheme);
      updateThemeIcon();

      // 设置语言
      document.getElementById('langSelect').value = currentLang;
      updateLanguage();

      // 绑定事件
      bindEvents();
    }

    // 更新语言
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

    // 更新主题图标
    function updateThemeIcon() {
      const icon = document.getElementById('themeIcon');
      icon.textContent = currentTheme === 'dark' ? '☀️' : '🌙';
    }

    // 显示 Toast
    function showToast(message, isError = false) {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.className = 'toast' + (isError ? ' error' : '');
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 3000);
    }

    // 绑定事件
    function bindEvents() {
      const uploadCard = document.getElementById('uploadCard');
      const fileInput = document.getElementById('fileInput');
      const themeToggle = document.getElementById('themeToggle');
      const langSelect = document.getElementById('langSelect');
      const downloadQr = document.getElementById('downloadQr');
      const copyUrl = document.getElementById('copyUrl');
      const uploadAnother = document.getElementById('uploadAnother');

      // 主题切换
      themeToggle.addEventListener('click', () => {
        currentTheme = currentTheme === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', currentTheme);
        localStorage.setItem('theme', currentTheme);
        updateThemeIcon();
      });

      // 语言切换
      langSelect.addEventListener('change', (e) => {
        currentLang = e.target.value;
        localStorage.setItem('lang', currentLang);
        updateLanguage();
      });

      // 拖拽上传
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

      // 文件选择
      fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
          handleFile(e.target.files[0]);
        }
      });

      // 下载二维码
      downloadQr.addEventListener('click', () => {
        const qrImage = document.getElementById('qrImage');
        const link = document.createElement('a');
        link.download = 'qrcode.png';
        link.href = qrImage.src;
        link.click();
      });

      // 复制链接
      copyUrl.addEventListener('click', async () => {
        const url = document.getElementById('imageUrl').textContent;
        try {
          await navigator.clipboard.writeText(url);
          showToast(i18n[currentLang].copySuccess);
        } catch {
          showToast(i18n[currentLang].copyError, true);
        }
      });

      // 再传一张
      uploadAnother.addEventListener('click', () => {
        document.getElementById('resultCard').classList.remove('show');
        fileInput.value = '';
      });
    }

    // 处理文件上传
    async function handleFile(file) {
      const progressBar = document.getElementById('progressBar');
      const resultCard = document.getElementById('resultCard');

      // 显示进度条
      progressBar.classList.add('show', 'indeterminate');
      resultCard.classList.remove('show');

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

        // 显示结果
        document.getElementById('previewImage').src = data.imageUrl;
        document.getElementById('qrImage').src = data.qrCode;
        document.getElementById('imageUrl').textContent = data.imageUrl;

        progressBar.classList.remove('show', 'indeterminate');
        resultCard.classList.add('show');

      } catch (error) {
        progressBar.classList.remove('show', 'indeterminate');
        showToast(error.message || i18n[currentLang].uploadError, true);
      }
    }

    // 启动应用
    init();
  </script>
</body>
</html>`;
}

export default app;

