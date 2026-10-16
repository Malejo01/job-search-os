import { createDb, loadLocalEnv } from "@job-search-os/db";
import { askInteractive, maskEmail, resolveTargetUrl, safeError } from "./common";
import {
  DEFAULT_ALLOWLIST,
  formatTestUserRow,
  listTestUsers,
  parseTestUsersArgs,
  readAllowlist,
  resetTestUser,
} from "./test-users";

/**
 * pnpm admin:test-users --list | --reset <email> [--allowlist <ruta>] [--show-emails] [--yes] [--remote]
 * Solo toca cuentas de la allowlist (por defecto ops/test-users.txt, desde donde se lanzó pnpm).
 * Local por defecto; la nube solo con --remote (y --yes no saltea esa confirmación).
 */
async function main(): Promise<void> {
  loadLocalEnv();
  const args = parseTestUsersArgs(process.argv.slice(2));
  if (!args.ok) {
    console.error(args.error);
    process.exitCode = 1;
    return;
  }
  // Contra la nube solo vale la allowlist por defecto: un archivo equivocado no amplía qué se borra
  if (args.remote && args.allowlist !== DEFAULT_ALLOWLIST) {
    console.error(`con --remote solo se usa la allowlist por defecto (${DEFAULT_ALLOWLIST})`);
    process.exitCode = 1;
    return;
  }
  const allowlist = readAllowlist(args.allowlist);
  if (!allowlist.ok) {
    console.error(allowlist.error);
    process.exitCode = 1;
    return;
  }

  // Confirmación del reset, antes de abrir ninguna conexión
  if (args.mode.kind === "reset") {
    if (!allowlist.emails.includes(args.mode.email)) {
      console.error("ese email no está en la allowlist: no se borra nada");
      process.exitCode = 1;
      return;
    }
    // --yes solo en local: contra la nube siempre se escribe el email
    if (!args.yes || args.remote) {
      const answer = await askInteractive(
        `Esto borra TODOS los datos de ${maskEmail(args.mode.email)}. Escribí el email completo para confirmar: `,
      );
      if (answer === null) {
        console.error(
          args.remote
            ? "no hay terminal para confirmar: contra la nube el borrado necesita una persona"
            : "no hay terminal para confirmar: usá --yes si de verdad querés seguir",
        );
        process.exitCode = 1;
        return;
      }
      if (answer.trim().toLowerCase() !== args.mode.email) {
        console.error("el email no coincide: no se borra nada");
        process.exitCode = 1;
        return;
      }
    }
  }

  const target = await resolveTargetUrl(
    args.remote,
    args.mode.kind === "reset"
      ? "borrar una cuenta de prueba en"
      : "consultar cuentas de prueba en",
  );
  if (!target.ok) {
    console.error(target.error);
    process.exitCode = 1;
    return;
  }
  const { db, close } = createDb(target.url, { max: 1 });
  try {
    console.log(`→ ${target.label}`);
    if (args.mode.kind === "list") {
      for (const row of await listTestUsers(db, allowlist.emails)) {
        console.log(formatTestUserRow(row, args.showEmails));
      }
      return;
    }
    const result = await resetTestUser(db, args.mode.email, allowlist.emails);
    if (!result.ok) {
      console.error(result.error);
      process.exitCode = 1;
      return;
    }
    const deleted = Object.values(result.counts).reduce((a, b) => a + b, 0);
    console.log(`cuenta borrada (${deleted} filas en total).`);
    console.log(
      "Siguiente paso: crear otra invitación con `pnpm admin:invite --by <email-admin>` y registrarse de nuevo.",
    );
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(`admin:test-users falló: ${safeError(error)}`);
  process.exit(1);
});
