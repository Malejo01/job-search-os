/* global process, console, URL */
// pnpm recorrido <url> [filtro de cuenta]: lanza el recorrido por carreras (T-1) contra la URL dada.
// La URL va como argumento (no como variable de entorno delante del comando). Solo https, salvo
// localhost y 127.0.0.1 (http); el resto de los argumentos se le pasa a Playwright (por ejemplo
// `-g abogacia-junior` para una sola cuenta). Sin shell: se lanza el CLI de Playwright con node.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

function parseUrl(value) {
  try {
    return value ? new URL(value) : null;
  } catch {
    return null;
  }
}

const [url, ...rest] = process.argv.slice(2);
const parsed = parseUrl(url);
const allowed =
  parsed !== null &&
  (parsed.protocol === "https:" ||
    (parsed.protocol === "http:" && LOCAL_HOSTS.has(parsed.hostname)));
if (!allowed) {
  console.error(
    "uso: pnpm recorrido <url> [-g <cuenta>]   (https, o http solo en localhost o 127.0.0.1; por ejemplo: pnpm recorrido http://localhost:3000)",
  );
  process.exit(1);
}

const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");
const result = spawnSync(
  process.execPath,
  [cli, "test", "-c", "playwright.recorrido.config.ts", ...rest],
  {
    stdio: "inherit",
    shell: false,
    env: { ...process.env, RECORRIDO_URL: parsed.origin },
  },
);
process.exit(result.status ?? 1);
