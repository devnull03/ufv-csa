/** @type {import('next').NextConfig} */
// import transpileModules from "next-transpile-modules";
// const withTM = transpileModules(["undici"]);

const nextConfig = {
  // Container builds (Dockerfile) set NEXT_OUTPUT=standalone for a small self-contained server.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" } : {}),
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.sanity.io",
      },
    ],
  },
  experimental: {
    taint: true,
  },
};

export default nextConfig;
