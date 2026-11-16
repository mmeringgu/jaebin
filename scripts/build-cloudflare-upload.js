// Cloudflare 웹 편집기에 붙여넣을 최신 Worker 코드를 만듭니다. 로그인·배포는 하지 않습니다.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

await build({
  entryPoints: [fileURLToPath(new URL("../src/index.js", import.meta.url))],
  outfile: fileURLToPath(new URL("../cloudflare-upload/worker.js", import.meta.url)),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  charset: "utf8",
});
console.log("최신 코드로 cloudflare-upload/worker.js를 생성했습니다.");
