import { defineConfig, loadEnv, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";

/**
 * 站点对外根地址 —— canonical / og:url / og:image 的基址。
 *
 * 为什么必须**构建期注入**：
 *   企业微信 / 钉钉 / 微信 / 邮件的预览卡片由**服务端抓取器**读取 `og:*`，抓取器**不执行 JS**。
 *   所以「运行时用 location.origin 补正 meta」只能兜住网页内动态分享，修不彻底 ——
 *   构建期写死正确域名是唯一彻底的解法。
 *
 * 为什么不放在 .env 里：
 *   本项目 .gitignore 排除了 `.env` 与 `.env.*`（仅保留 .env.example），
 *   把地址放进去等于**不可复现** —— 换台机器 / 交给同事构建时会静默回落到旧值。
 *   该值不是密钥（本就是要公开给抓取器的地址），因此放在这里纳入版本控制，
 *   同时保留环境变量覆盖能力（VITE_SITE_URL 优先级更高，便于绑定自定义域名后切换）。
 *
 * ⚠️ 换域名或改部署路径时改这一处即可；必须带结尾斜杠（og:image 直接拼文件名）。
 */
const DEFAULT_SITE_URL =
  "https://da-tool-list-d2g0awsejc0658949-1464163374.tcloudbaseapp.com/workpreparation-01/";

/** 把 index.html 中的 %VITE_SITE_URL% 替换为实际站点地址，并在构建期校验其合法性。 */
function siteUrlPlugin(siteUrl: string): Plugin {
  return {
    name: "toolbox:inject-site-url",
    buildStart() {
      let parsed: URL;
      try {
        parsed = new URL(siteUrl);
      } catch {
        this.error(
          `站点地址不是合法绝对 URL：${JSON.stringify(siteUrl)}。` +
            `请修正 vite.config.ts 的 DEFAULT_SITE_URL 或环境变量 VITE_SITE_URL。`,
        );
        return;
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        this.error(`站点地址必须是 http(s) 绝对地址，实际：${siteUrl}`);
      }
      if (!siteUrl.endsWith("/")) {
        // 否则 og:image 会拼成 ".../workpreparation-01favicon-512x512.png"
        this.error(`站点地址必须以 / 结尾（og:image 直接拼接文件名），实际：${siteUrl}`);
      }
    },
    // Vite 自带的 %VITE_*% 替换只在变量存在于 env 时才生效；
    // 显式替换可保证「无论 env 是否定义」都不会把占位符漏进产物。
    transformIndexHtml(html) {
      return html.replaceAll("%VITE_SITE_URL%", siteUrl);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backend = env.VITE_DEV_PROXY_TARGET || "http://127.0.0.1:8000";
  const siteUrl = (env.VITE_SITE_URL || DEFAULT_SITE_URL).trim();

  return {
    base: "./",
    plugins: [vue(), siteUrlPlugin(siteUrl)],
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": { target: backend, changeOrigin: true },
      },
    },
    preview: {
      host: "127.0.0.1",
      port: 4173,
      strictPort: true,
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks: {
            spreadsheet: ["xlsx"],
            screenshot: ["html2canvas"],
          },
        },
      },
    },
  };
});
