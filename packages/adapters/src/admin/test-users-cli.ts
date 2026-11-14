import { createDb, loadLocalEnv } from "@job-search-os/db";
import { askInteractive, maskEmail, resolveTargetUrl, safeError } from "./common";
import {
  DEFAULT_ALLOWLIST,
  DEFAULT_CREDENTIALS,
  formatTestUserRow,
  listTestUsers,
  parseTestUsersArgs,
  readAllowlist,
  RESET_ALL_PHRASE,
  resetAllTestUsers,
  resetTestUser,
} from "./test-users";
import {
  createTestUsers,
  fileCredentialStore,
  formatCreateRow,
  readTermsVersion,
} from "./test-users-create";

/**
 * pnpm admin:test-users --list | --reset <email> | --reset-all | --create --by <email-admin>
 *   [--credentials <ruta>] [--allowlist <ruta>] [--admin-emails <lista> --ingest-domain <dominio>]
 *   [--show-emails] [--yes] [--remote]
 * --create --remote exige --admin-emails e --ingest-domain: no toma esos valores del .env.local.
 * --create: registra las cuentas de la allowlist por el camino real; las contraseñas van solo a
 * ops/test-users-credenciales.json y nunca se imprimen. --reset-all: borra todas con una frase.
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

  // --reset-all: UNA confirmación, escribiendo una frase (también con --remote; --yes solo vale en local)
  if (args.mode.kind === "reset-all" && (!args.yes || args.remote)) {
    const answer = await askInteractive(
      `Esto borra TODAS las cuentas de la allowlist (${allowlist.emails.length}). Escribí «${RESET_ALL_PHRASE}» para confirmar: `,
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
    if (answer.trim().toLowerCase() !== RESET_ALL_PHRASE) {
      console.error("la frase no coincide: no se borra nada");
      process.exitCode = 1;
      return;
    }
  }

  let termsVersion = "";
  if (args.mode.kind === "create") {
    const terms = readTermsVersion();
    if (!terms.ok) {
      console.error(terms.error);
      process.exitCode = 1;
      return;
    }
    termsVersion = terms.version;
  }

  const target = await resolveTargetUrl(
    args.remote,
    args.mode.kind === "reset" || args.mode.kind === "reset-all"
      ? "borrar cuentas de prueba en"
      : args.mode.kind === "create"
        ? "crear cuentas de prueba en"
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
    if (args.mode.kind === "create") {
      const store = fileCredentialStore(args.mode.credentials);
      // Contra la nube, ADMIN_EMAILS e INGEST_DOMAIN salen SOLO de los argumentos (el parser los exige):
      // el .env.local de esta máquina no decide a quién se omite ni en qué dominio quedan las direcciones.
      // En local, un argumento pisa al entorno y lo que falte viene del entorno, como siempre.
      const env: Record<string, string | undefined> = args.remote
        ? { ADMIN_EMAILS: args.adminEmails, INGEST_DOMAIN: args.ingestDomain }
        : {
            ...process.env,
            ...(args.adminEmails !== undefined ? { ADMIN_EMAILS: args.adminEmails } : {}),
            ...(args.ingestDomain !== undefined ? { INGEST_DOMAIN: args.ingestDomain } : {}),
          };
      const adminCount = (env.ADMIN_EMAILS ?? "").split(",").filter((e) => e.trim()).length;
      console.log(
        `→ ${args.remote ? "valores explícitos por argumento" : "valores del entorno (o del argumento)"}: ` +
          `INGEST_DOMAIN=${env.INGEST_DOMAIN ?? "ingest.local (por defecto)"}, ` +
          `ADMIN_EMAILS=${adminCount} email(s)`,
      );
      const created = await createTestUsers(db, allowlist.emails, {
        by: args.mode.by,
        termsVersion,
        store,
        env,
      });
      if (!created.ok) {
        console.error(created.error);
        process.exitCode = 1;
        return;
      }
      for (const row of created.rows) console.log(formatCreateRow(row, args.showEmails));
      const n = created.rows.filter((r) => r.status === "creada").length;
      console.log(
        `${n} cuenta(s) creada(s). Las contraseñas están en ${args.mode.credentials} (no se imprimen).`,
      );
      if (created.rows.some((r) => r.status === "error")) process.exitCode = 1;
      return;
    }
    if (args.mode.kind === "reset-all") {
      const store = fileCredentialStore(DEFAULT_CREDENTIALS);
      for (const row of await resetAllTestUsers(db, allowlist.emails)) {
        if (row.status === "borrada") store.drop(row.email);
        const who = args.showEmails ? row.email : maskEmail(row.email);
        console.log(
          `${who}  ${row.status}${row.status === "borrada" ? ` (${row.rows} filas)` : ""}${row.reason ? ` (${row.reason})` : ""}`,
        );
      }
      return;
    }
    const result = await resetTestUser(
      db,
      args.mode.email,
      allowlist.emails,
      process.env.ADMIN_EMAILS,
      { force: args.mode.force === true },
    );
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
