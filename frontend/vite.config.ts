import path from "path";
import { defineConfig, loadEnv, type ConfigEnv } from "vite";
import checker from "vite-plugin-checker";
import react from "@vitejs/plugin-react";
import { createHtmlPlugin } from "vite-plugin-html";

function splitVendorChunk(id: string): string | undefined {
  const normalizedId = id.replace(/\\/g, "/");
  if (!normalizedId.includes("node_modules")) return undefined;

  if (
    normalizedId.includes("/react/") ||
    normalizedId.includes("/react-dom/") ||
    normalizedId.includes("/react-router-dom/") ||
    normalizedId.includes("/zustand/")
  ) {
    return "vendor-react";
  }

  if (
    normalizedId.includes("/@codemirror/") ||
    normalizedId.includes("/codemirror/") ||
    normalizedId.includes("/thememirror/")
  ) {
    return "vendor-editor";
  }

  if (
    normalizedId.includes("/react-markdown/") ||
    normalizedId.includes("/react-syntax-highlighter/") ||
    normalizedId.includes("/highlight.js/") ||
    normalizedId.includes("/lowlight/") ||
    normalizedId.includes("/unified/") ||
    normalizedId.includes("/remark-") ||
    normalizedId.includes("/rehype-") ||
    normalizedId.includes("/micromark") ||
    normalizedId.includes("/mdast-util-") ||
    normalizedId.includes("/hast-util-") ||
    normalizedId.includes("/vfile")
  ) {
    return "vendor-markdown";
  }

  if (
    normalizedId.includes("/@radix-ui/") ||
    normalizedId.includes("/react-icons/") ||
    normalizedId.includes("/class-variance-authority/") ||
    normalizedId.includes("/tailwind-merge/") ||
    normalizedId.includes("/clsx/") ||
    normalizedId.includes("/classnames/")
  ) {
    return "vendor-ui";
  }

  if (
    normalizedId.includes("/html2canvas/") ||
    normalizedId.includes("/webm-duration-fix/")
  ) {
    return "vendor-capture";
  }

  return "vendor";
}

// https://vitejs.dev/config/
export default ({ command, mode }: ConfigEnv) => {
  process.env = { ...process.env, ...loadEnv(mode, process.cwd()) };
  return defineConfig({
    base: "",
    plugins: [
      react(),
      command === "serve" &&
        checker({
          typescript: true,
        }),
      createHtmlPlugin({
        inject: {
          data: {
            injectHead: process.env.VITE_IS_DEPLOYED
              ? '<script defer="" data-domain="screenshottocode.com" src="https://plausible.io/js/script.js"></script>'
              : "",
          },
        },
      }),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: splitVendorChunk,
        },
      },
    },
  });
};
