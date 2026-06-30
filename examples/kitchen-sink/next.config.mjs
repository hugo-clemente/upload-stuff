/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  transpilePackages: [
    "@upload-stuff/core",
    "@upload-stuff/server",
    "@upload-stuff/client",
  ],
};

export default config;
