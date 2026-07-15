import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  transpilePackages: [
    '@upload-stuff/core',
    '@upload-stuff/server',
    '@upload-stuff/client',
  ],
  async redirects() {
    return [
      {
        source: '/docs/handlers',
        destination: '/docs/server/handlers',
        permanent: true,
      },
      {
        source: '/docs/api',
        destination: '/docs/reference/server',
        permanent: true,
      },
    ];
  },
};

export default withMDX(config);
