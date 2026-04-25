import { defineConfig } from "vite";

export default defineConfig({
  plugins: [],
  server: {
    host: true,
    port: 4820,
    allowedHosts: true,
  },
  preview: {
    host: true,
    port: 4820,
  },
});
