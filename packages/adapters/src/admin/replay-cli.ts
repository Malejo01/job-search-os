import { createDb, loadLocalEnv } from "@job-search-os/db";
import { createLogger } from "../logger";
import { normalizeEmail, resolveTargetUrl, safeError } from "./common";
import { loadReplayFixture, parseReplayArgs, replayInbound } from "./replay";
import { DEFAULT_ALLOWLIST, readAllowlist } from "./test-users";

/**
 * pnpm inbound:replay <fixture.json> --to <email-de-usuario> [--remote]
 * Reproduce un email sintético por el mismo despacho que el webhook (JS-020). Local por defecto.
 * Nunca imprime el contenido del email ni la dirección de ingesta del usuario.
 */
async function main(): Promise<void> {
  loadLocalEnv();
  process.env.LOG_LEVEL ??= "warn";
  const args = parseReplayArgs(process.argv.slice(2));
  if (!args.ok) {
    console.error(args.error);
    process.exitCode = 1;
    return;
  }
  const fixture = loadReplayFixture(args.fixture);
  if (!fixture.ok) {
    console.error(fixture.error);
    process.exitCode = 1;
    return;
  }
  // Contra la nube solo a cuentas de prueba: un replay ingesta datos y encola evaluaciones (LLM)
  if (args.remote) {
    const allowlist = readAllowlist(DEFAULT_ALLOWLIST);
    if (!allowlist.ok || !allowlist.emails.includes(normalizeEmail(args.to))) {
      console.error(
        `con --remote, --to tiene que ser una cuenta de prueba de ${DEFAULT_ALLOWLIST}: no se hace nada`,
      );
      process.exitCode = 1;
      return;
    }
  }
  const target = await resolveTargetUrl(args.remote, "reproducir un email en");
  if (!target.ok) {
    console.error(target.error);
    process.exitCode = 1;
    return;
  }
  const { db, close } = createDb(target.url, { max: 2 });
  try {
    console.log(`→ ${target.label}`);
    const result = await replayInbound(fixture.loaded, args.to, { db, logger: createLogger() });
    if (!result.ok) {
      console.error(result.error);
      process.exitCode = 1;
      return;
    }
    console.log(`parser: ${result.parser ?? "ninguno"}`);
    console.log(`jobs extraídos: ${result.jobsExtracted}`);
    console.log(`destino: ${result.destination}`);
    console.log(`inbound_emails.id: ${result.inboundId}`);
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(`inbound:replay falló: ${safeError(error)}`);
  process.exit(1);
});
