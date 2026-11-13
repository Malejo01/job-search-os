// pnpm recorrido <url> [filtro de cuenta]: lanza el recorrido por carreras (T-1) contra la URL dada.
// La URL va como argumento (no como variable de entorno delante del comando). Solo http(s); el resto de
// los argumentos se le pasa a Playwright (por ejemplo `-g abogacia-junior` para una sola cuenta).
/* global process, console, URL */
import { spawnSync } from "node:child_process";

const [url, ...rest] = process.argv.slice(2);
function parseUrl(value) {
  try {
    return value ? new URL(value) : null;
  } catch {
    return null;
  }
}
const parsed = parseUrl(url);
if (!parsed || !["http:", "https:"].includes(parsed.protocol)) {
  console.error(
    "uso: pnpm recorrido <url> [-g <cuenta>]   (por ejemplo: pnpm recorrido http://localhost:3000)",
  );
  process.exit(1);
}

const result = spawnSync(
  "pnpm",
  ["exec", "playwright", "test", "-c", "playwright.recorrido.config.ts", ...rest],
  {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, RECORRIDO_URL: parsed.origin },
  },
);
process.exit(result.status ?? 1);
