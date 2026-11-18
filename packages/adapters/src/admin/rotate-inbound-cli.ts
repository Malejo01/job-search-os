import { createDb, loadLocalEnv } from "@job-search-os/db";
import { askInteractive, resolveTargetUrl, safeError } from "./common";
import {
  parseRotateInboundArgs,
  ROTATE_INBOUND_PHRASE,
  rotateLegacyInboundAddresses,
} from "./rotate-inbound";

/**
 * pnpm --filter @job-search-os/adapters exec tsx src/admin/rotate-inbound-cli.ts [--apply] [--remote]
 * Sin --apply solo cuenta. Local por defecto; la nube solo con --remote, que pide confirmar el destino.
 * Aplicar siempre pide escribir una frase en la terminal.
 */
async function main(): Promise<void> {
  loadLocalEnv();
  const args = parseRotateInboundArgs(process.argv.slice(2));
  if (!args.ok) {
    console.error(args.error);
    process.exitCode = 1;
    return;
  }
  if (args.apply) {
    const answer = await askInteractive(
      `Quien reenvía correo a una dirección vieja va a dejar de recibirlo hasta actualizar su filtro. Escribí «${ROTATE_INBOUND_PHRASE}» para confirmar: `,
    );
    if (answer?.trim().toLowerCase() !== ROTATE_INBOUND_PHRASE) {
      console.error("sin confirmación: no se cambia nada");
      process.exitCode = 1;
      return;
    }
  }
  const target = await resolveTargetUrl(args.remote, "rotar direcciones de ingesta en");
  if (!target.ok) {
    console.error(target.error);
    process.exitCode = 1;
    return;
  }
  const { db, close } = createDb(target.url, { max: 1 });
  try {
    console.log(`→ ${target.label}`);
    const result = await rotateLegacyInboundAddresses(db, { apply: args.apply });
    console.log(
      `perfiles: ${result.scanned} · direcciones viejas: ${result.legacy} · rotadas: ${result.rotated} · fallidas: ${result.failed}`,
    );
    if (result.failed > 0) process.exitCode = 1;
  } catch (error) {
    console.error(safeError(error));
    process.exitCode = 1;
  } finally {
    await close();
  }
}

void main();
