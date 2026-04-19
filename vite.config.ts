import { defineConfig } from "vite";
import mkcert from "vite-plugin-mkcert";

export default defineConfig({
  plugins: [mkcert()],
  server: {
    host: true,
    port: 4820,
    https: true,
  },
  preview: {
    host: true,
    port: 4820,
    https: true,
  },
});
