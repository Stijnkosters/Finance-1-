/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // pdf-parse (met gebundelde pdf.js) niet mee-bundelen maar op de server
  // gewoon via require laden — voorkomt build/bundelfouten.
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse"],
  },
};
export default nextConfig;
