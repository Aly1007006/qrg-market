import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  images: {
    // Uploaded media is already resized/WebP. Never cache protected media through
    // the optimizer, including caller-constructed /_next/image URLs.
    localPatterns: [
      { pathname: '/dev-fixtures/**', search: '' },
      { pathname: '/brand/**', search: '' },
    ],
    remotePatterns: process.env.QRG_MEDIA_ORIGIN
      ? [new URL('/products/**', process.env.QRG_MEDIA_ORIGIN)]
      : [],
  },
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
};
export default config;
