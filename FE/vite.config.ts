import { createServer, defineConfig, loadEnv, type Plugin } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { apiMiddleware, type ApiRequest, type ApiResponse } from "./server/routes";
import { startPerformanceScheduler } from "./server/performance";

declare const process: {
  cwd: () => string;
  env: Record<string, string | undefined>;
};

function kisApiPlugin(): Plugin {
  return {
    configureServer(server) {
      if (!process.env.VITEST) {
        const stop = startPerformanceScheduler();
        server.httpServer?.once("close", stop);
      }
      server.middlewares.use((request, response, next) => {
        apiMiddleware(request as unknown as ApiRequest, response as unknown as ApiResponse, next);
      });
    },
    name: "kis-api",
  };
}

/** Render the same introduction copy for direct visits with JavaScript disabled. */
function staticAboutPlugin(): Plugin {
  return {
    name: "static-about",
    apply: "build",
    enforce: "post",
    async generateBundle(_options, bundle) {
      const server = await createServer({ configFile: false, envFile: false, root: process.cwd(), plugins: [react()], optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
      try {
        const { AboutContent, ABOUT_DESCRIPTION } = await server.ssrLoadModule("/src/features/about/AboutContent.tsx");
        const { BRAND_NAME } = await server.ssrLoadModule("/src/shared/lib/brand.tsx");
        const index = bundle["index.html"];
        if (!index || index.type !== "asset") throw new Error("Missing built HTML for introduction");
        const markup = renderToStaticMarkup(createElement(AboutContent));
        const css = Object.values(bundle).filter(asset => /(?:^|\/)AboutPage-[^/]+\.css$/.test(asset.fileName)).map(asset => `<link rel="stylesheet" href="/${asset.fileName}" />`).join("");
        const html = String(index.source)
          .replace(/<title>.*?<\/title>/, `<title>서비스 소개 · ${BRAND_NAME}</title>`)
          .replace(/(<meta\s+name="description"\s+content=")[^"]*/, `$1${ABOUT_DESCRIPTION}`)
          .replace(/(<meta\s+(?:property|name)="(?:og:title|twitter:title)"\s+content=")[^"]*/g, `$1서비스 소개 · ${BRAND_NAME}`)
          .replace(/(<meta\s+(?:property|name)="(?:og:description|twitter:description)"\s+content=")[^"]*/g, `$1${ABOUT_DESCRIPTION}`)
          .replace("</head>", `${css}</head>`)
          .replace('<div id="root"></div>', `<div id="root"><div class="ds-root min-h-dvh bg-bg font-sans text-fg"><main id="main-content" class="ds-main px-7 pt-5 pb-12">${markup}</main></div></div>`);
        this.emitFile({ type: "asset", fileName: "about/index.html", source: html });
        this.emitFile({ type: "asset", fileName: "about.html", source: html });
      } finally { await server.close(); }
    },
  };
}

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));

  return {
    plugins: [react(), tailwindcss(), kisApiPlugin(), staticAboutPlugin()],
    server: {
      // Bind to all interfaces so the dev server is reachable over the LAN and
      // through a tunnel (Cloudflare Tunnel / ngrok), not just on localhost.
      host: true,
      // Keep local development on one canonical port. If another dev server is
      // already using it, fail fast instead of silently opening 5174/5175 and
      // splitting API state across multiple Vite processes.
      port: process.env.PORT ? Number(process.env.PORT) : 5173,
      strictPort: true,
      // Dev only: accept any Host header so dynamic tunnel domains
      // (*.trycloudflare.com, *.ngrok-free.app) aren't rejected by Vite's
      // host check. Does not affect production builds.
      allowedHosts: true,
    },
  };
});
