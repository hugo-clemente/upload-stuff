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
};

export default withMDX(config);
