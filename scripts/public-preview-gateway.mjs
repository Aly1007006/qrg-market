// Read-only fixture preview. Never connect this service to application networks.
import { createServer, request } from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { cp } from 'node:fs/promises';

export function allowedPreviewPath(raw) {
  if (!raw || raw.length > 4096 || !raw.startsWith('/') || raw.startsWith('//'))
    return false;
  const rawPath = raw.split('?')[0];
  let path;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    return false;
  }
  if (
    /[\\%\x00-\x20]/.test(path) ||
    path.split('/').some((p) => p === '..' || p === '.')
  )
    return false;
  const pages = [
    '/',
    '/catalog',
    '/shops',
    '/favorites',
    '/icon.svg',
    '/api/search',
  ];
  if (pages.includes(path)) return true;
  if (/^\/(product|shop)\/demo-[a-z0-9-]+$/.test(path)) return true;
  if (/^\/(dev-fixtures|brand)\/[a-z0-9-]+\.(jpg|png|webp)$/.test(path))
    return true;
  if (path.startsWith('/_next/static/') && /\.(js|css|woff2?)$/.test(path))
    return true;
  if (path === '/_next/image') {
    const params = new URL(raw, 'http://preview.invalid').searchParams;
    if (params.getAll('url').length !== 1) return false;
    return /^\/(dev-fixtures|brand)\/[a-z0-9-]+\.(jpg|png|webp)$/.test(
      params.get('url') ?? '',
    );
  }
  return false;
}

const closedPage =
  '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex,nofollow"><title>Демонстрация QRG MARKET</title><body style="font-family:system-ui;max-width:600px;margin:12vh auto;padding:24px"><h1>Демонстрация QRG MARKET</h1><p>Здесь доступен только просмотр тестового каталога. Регистрация, кабинеты, заявки и платежи отключены. Рабочая база не подключена.</p><a href="/">Вернуться на главную</a></body></html>';

export function previewGateway(upstreamPort) {
  let active = 0;
  let windowStart = Date.now();
  let requestCount = 0;
  const server = createServer(
    { maxHeaderSize: 16384 },
    (incoming, outgoing) => {
      outgoing.setHeader('X-Robots-Tag', 'noindex, nofollow');
      outgoing.setHeader('X-Content-Type-Options', 'nosniff');
      outgoing.setHeader('X-Frame-Options', 'DENY');
      outgoing.setHeader('Referrer-Policy', 'no-referrer');
      outgoing.setHeader('Cache-Control', 'no-store');
      if (incoming.url === '/robots.txt') {
        outgoing.writeHead(200, { 'Content-Type': 'text/plain' });
        return outgoing.end('User-agent: *\nDisallow: /\n');
      }
      if (
        !['GET', 'HEAD'].includes(incoming.method) ||
        incoming.headers['transfer-encoding'] ||
        Number(incoming.headers['content-length'] ?? 0) !== 0 ||
        !allowedPreviewPath(incoming.url)
      ) {
        outgoing.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
        return outgoing.end(incoming.method === 'HEAD' ? '' : closedPage);
      }
      if (Date.now() - windowStart >= 60000) {
        windowStart = Date.now();
        requestCount = 0;
      }
      if (++requestCount > 1200 || active >= 24) {
        outgoing.writeHead(429, { 'Retry-After': '30' });
        return outgoing.end('Preview capacity exceeded');
      }
      active++;
      let released = false;
      const release = () => {
        if (!released) {
          released = true;
          active--;
        }
      };
      outgoing.once('close', release);
      const headers = { host: `127.0.0.1:${upstreamPort}` };
      for (const name of [
        'accept',
        'accept-encoding',
        'rsc',
        'next-router-state-tree',
        'next-router-prefetch',
        'next-url',
      ]) {
        if (typeof incoming.headers[name] === 'string')
          headers[name] = incoming.headers[name];
      }
      const upstream = request(
        {
          hostname: '127.0.0.1',
          port: upstreamPort,
          method: incoming.method,
          path: incoming.url,
          headers,
          timeout: 45000,
        },
        (response) => {
          outgoing.statusCode = response.statusCode ?? 502;
          for (const name of [
            'content-type',
            'content-encoding',
            'vary',
            'content-security-policy',
          ]) {
            if (response.headers[name])
              outgoing.setHeader(name, response.headers[name]);
          }
          response.on('error', () => outgoing.destroy());
          response.pipe(outgoing);
        },
      );
      upstream.on('timeout', () => upstream.destroy());
      upstream.on('error', () => {
        if (!outgoing.headersSent) {
          outgoing.writeHead(502);
          outgoing.end('Preview temporarily unavailable');
        } else outgoing.destroy();
      });
      outgoing.once('close', () => upstream.destroy());
      upstream.end();
    },
  );
  server.on('upgrade', (_request, socket) => socket.destroy());
  server.headersTimeout = 10000;
  server.requestTimeout = 15000;
  server.keepAliveTimeout = 5000;
  return server;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  // Next dev updates generated files. All writes stay in disposable tmpfs, not
  // in the immutable source or the user's checkout.
  await cp('/fixture-source', new URL('../apps/web/', import.meta.url), {
    recursive: true,
    verbatimSymlinks: true,
  });
  const webRequire = createRequire(
    new URL('../apps/web/package.json', import.meta.url),
  );
  const child = spawn(
    process.execPath,
    [
      webRequire.resolve('next/dist/bin/next'),
      'dev',
      '-H',
      '127.0.0.1',
      '-p',
      '3101',
    ],
    {
      cwd: new URL('../apps/web/', import.meta.url),
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'development',
        QRG_DEV_FIXTURES: 'true',
        NEXT_TELEMETRY_DISABLED: '1',
      },
      stdio: ['ignore', 'ignore', 'inherit'],
    },
  );
  const server = previewGateway(3101);
  server.listen(8080, '0.0.0.0', () =>
    console.log(
      'Read-only fixture preview gateway listening. No database connected.',
    ),
  );
  child.once('error', () => {
    console.error('Fixture preview failed to start.');
    server.close();
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    console.error(`Fixture worker exited (code=${code}, signal=${signal}).`);
    server.close();
    process.exitCode = 1;
  });
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.once(signal, () => {
      child.kill('SIGTERM');
      server.close();
    });
}
