import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main:   resolve(__dirname, "index.html"),
        docs:   resolve(__dirname, "docs.html"),
        reader: resolve(__dirname, "reader.html"),
        crm:    resolve(__dirname, "crm.html"),
        lex:    resolve(__dirname, "lex.html"),
      },
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/uploads": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
