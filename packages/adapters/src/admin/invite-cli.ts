import { createDb, loadLocalEnv } from "@job-search-os/db";
import { resolveTargetUrl, safeError } from "./common";
import { createInvitationAsAdmin, parseInviteArgs } from "./invite";

/**
 * pnpm admin:invite [--email <email>] --by <email-admin> [--remote]
 * Local por defecto. En producción lo corre Mauro, con --remote y confirmación (docs/OPERACION.md).
 * Imprime el link de la invitación UNA vez: es lo único que sale en claro.
 */
async function main(): Promise<void> {
  loadLocalEnv();
  const args = parseInviteArgs(process.argv.slice(2));
  if (!args.ok) {
    console.error(args.error);
    process.exitCode = 1;
    return;
  }
  const target = await resolveTargetUrl(args.remote, "crear una invitación en");
  if (!target.ok) {
    console.error(target.error);
    process.exitCode = 1;
    return;
  }
  const { db, close } = createDb(target.url, { max: 1 });
  try {
    console.log(`→ ${target.label}`);
    const result = await createInvitationAsAdmin(db, { by: args.by, email: args.email });
    if (!result.ok) {
      console.error(result.error);
      process.exitCode = 1;
      return;
    }
    console.log(`invitación ${result.id} creada, vence ${result.expiresAt.toISOString()}`);
    console.log(
      result.link
        ? `link: ${result.link}`
        : `falta AUTH_URL o NEXT_PUBLIC_APP_URL: armá el link a mano como <base>/register?code=${result.code}`,
    );
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(`admin:invite falló: ${safeError(error)}`);
  process.exit(1);
});
