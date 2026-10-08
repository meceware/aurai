const production = process.env.NODE_ENV === 'production';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  // Read with fs at runtime (migrations) or loaded by the dynamic linker (libvips), so the
  // tracer cannot see them; listed here so the standalone bundle is complete on its own.
  outputFileTracingIncludes: {
    '/**': ['./migrations/*.sql', './node_modules/@img/**/*'],
  },
  // A guard: a build must never carry anyone's database or photos. (What keeps the data folder
  // out of the instrumentation trace, which this does not reach, is turbopackIgnore in config.js.)
  outputFileTracingExcludes: {
    '/**': ['./data/**/*', './.env*'],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
          ...(production ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }] : []),
        ],
      },
    ];
  },
};

export default nextConfig;
