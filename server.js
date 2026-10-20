import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = '0.0.0.0';

const RESOLVER_UPSTREAM = 'https://resolver.openmotionapp.my.id';
const SPOOF_ORIGIN = 'https://hada45.github.io';
const SPOOF_REFERER = 'https://hada45.github.io/Open-Motion/';

// Register custom mime types
express.static.mime.define({
  'application/manifest+json': ['webmanifest'],
  'application/javascript': ['js'],
  'application/octet-stream': ['wasm']
});

// Configure headers for PWA and service worker
app.use((req, res, next) => {
  if (req.path === '/sw.js') {
    res.setHeader('Service-Worker-Allowed', '/');
    res.setHeader('Cache-Control', 'no-cache');
  }
  next();
});

// AM Media Proxy Helper: for fetching external media without CORS issues
app.get('/api/am/proxy-media', async (req, res) => {
  try {
    const targetUrl = req.query.url;
    if (!targetUrl || typeof targetUrl !== 'string') {
      return res.status(400).send('Parameter url diperlukan.');
    }
    const mediaRes = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*'
      }
    });
    res.status(mediaRes.status);
    mediaRes.headers.forEach((val, key) => {
      const lower = key.toLowerCase();
      if (!['content-encoding', 'connection', 'keep-alive', 'transfer-encoding', 'alt-svc'].includes(lower)) {
        res.setHeader(key, val);
      }
    });
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (!mediaRes.body) return res.end();
    Readable.fromWeb(mediaRes.body).pipe(res);
  } catch (err) {
    console.error('AM Proxy Media Error:', err.message);
    res.status(502).send('Gagal mengunduh media eksternal.');
  }
});

// AM Resolver Proxy: forward requests to Cloudflare resolver with required Origin & Referer headers
app.all('/api/am/*', async (req, res) => {
  try {
    const upstreamUrl = new URL(req.originalUrl, RESOLVER_UPSTREAM);
    const headers = {
      'Origin': SPOOF_ORIGIN,
      'Referer': SPOOF_REFERER,
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': req.headers['accept'] || '*/*'
    };
    if (req.headers['range']) {
      headers['Range'] = req.headers['range'];
    }

    const fetchMethod = req.method === 'HEAD' ? 'GET' : req.method;
    const fetchOptions = {
      method: fetchMethod,
      headers,
      redirect: 'follow'
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      fetchOptions.body = req;
      fetchOptions.duplex = 'half';
    }

    let upstreamRes = await fetch(upstreamUrl.href, fetchOptions);

    // Auto-fallback: if official AM package exceeds 5MB (e.g. 9.33 MB), seamlessly switch to zervida provider (>5MB supported)
    if (upstreamUrl.pathname === '/api/am/project' && upstreamUrl.searchParams.get('provider') === 'official') {
      if (upstreamRes.status === 413 || !upstreamRes.ok) {
        try {
          const clone = upstreamRes.clone();
          const data = await clone.json().catch(() => null);
          if (data && (data.code === 'PACKAGE_TOO_LARGE' || (data.error && data.error.includes('5.00 MB')))) {
            const fallbackUrl = new URL(upstreamUrl.href);
            fallbackUrl.searchParams.set('provider', 'zervida');
            upstreamRes = await fetch(fallbackUrl.href, fetchOptions);
          }
        } catch {}
      }
    }

    res.status(upstreamRes.status);
    upstreamRes.headers.forEach((val, key) => {
      const lower = key.toLowerCase();
      if (!['content-encoding', 'connection', 'keep-alive', 'transfer-encoding', 'alt-svc'].includes(lower)) {
        res.setHeader(key, val);
      }
    });

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }

    if (!upstreamRes.body || req.method === 'HEAD') {
      return res.end();
    }

    Readable.fromWeb(upstreamRes.body).pipe(res);
  } catch (err) {
    console.error('AM Resolver Proxy Error:', err.message);
    if (req.path === '/api/am/status') {
      return res.status(200).json({
        version: "V5.194",
        protocol: 2,
        resolver: "open-motion-cloudflare-am",
        authentication: "none",
        mode: "dual-anonymous",
        providers: ["official", "zervida"],
        maxPackageBytes: 268435456,
        maxZervidaMediaBytes: 268435456,
        stateless: true,
        offline: true
      });
    }
    res.status(502).json({
      error: 'Backend resolver Cloudflare tidak dapat dihubungi. Periksa internet lalu coba lagi; editor lokal tetap bisa digunakan.',
      code: 'RESOLVER_UNAVAILABLE'
    });
  }
});

// Serve static assets from app root
app.use(express.static(__dirname, {
  index: 'index.html',
  extensions: ['html']
}));

// Fallback to index.html for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Open Motion server listening on http://${HOST}:${PORT}`);
});
