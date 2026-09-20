import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export', // Tells Next.js to create static HTML files for GitHub Pages
  basePath: '/omniscope', // Tells the app it lives in the /omniscope folder
  images: {
    unoptimized: true, // REQUIRED: GitHub Pages cannot optimize Next.js images automatically
  },
};

export default nextConfig;
