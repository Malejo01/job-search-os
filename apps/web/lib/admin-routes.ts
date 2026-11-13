/**
 * Qué archivos de `apps/web/app` son solo para admins (R11-6). Sin imports: lo lee el test que recorre
 * el árbol (`packages/pipeline/src/admin-routes.test.ts`) y no hace falta cargar la app para eso.
 *
 * Regla: toda `page`, `route` y archivo de Server Actions bajo `settings/**` o `admin/**` tiene que
 * figurar en UNA de las dos listas. Si es de admin, el test exige que llame a `lib/admin-guard.ts`; si
 * es de cualquier cuenta, queda en `MEMBER_FILES`. Un archivo nuevo sin lista hace fallar el test: así
 * nadie suma una pantalla de administración sin decidir quién la ve.
 *
 * Las rutas se escriben relativas a `apps/web/app`, con barras `/`.
 */

/** Solo admins (`ADMIN_EMAILS`): 404 a cualquier otra cuenta, comprobado en el servidor. */
export const ADMIN_ONLY_FILES: readonly string[] = [
  // Pantallas
  "(app)/settings/invitations/page.tsx",
  "(app)/settings/planes/page.tsx",
  "(app)/settings/marca/page.tsx",
  "(app)/settings/marca/componentes/page.tsx",
  "(app)/settings/textos/page.tsx",
  "(app)/settings/metricas/page.tsx",
  "(app)/settings/salud/page.tsx",
  "(app)/settings/feedback/page.tsx",
  "(app)/ui/page.tsx",
  // Rutas de descarga y de vista previa
  "(app)/settings/invitations/export/route.ts",
  "(app)/settings/feedback/export/route.ts",
  "(app)/settings/marca/email-bienvenida/route.ts",
  // Server Actions
  "(app)/settings/invitations/actions.ts",
  "(app)/settings/planes/actions.ts",
  "(app)/settings/feedback/actions.ts",
];

/** Para cualquier cuenta con sesión (cada una opera solo sobre lo suyo, por RLS). */
export const MEMBER_FILES: readonly string[] = [
  "(app)/settings/page.tsx",
  "(app)/settings/actions.ts",
  // Reenvío de emails: lo usa cualquier persona, no es de administración
  "(app)/settings/asistente/page.tsx",
  // Tokens del MCP: lo gobierna el flag del asistente (`canUseMcpTokens`), no el rol de admin
  "(app)/settings/conexiones/page.tsx",
  "(app)/settings/conexiones/actions.ts",
  "(app)/settings/criteria/page.tsx",
  "(app)/settings/criteria/actions.ts",
  "(app)/settings/historial/page.tsx",
  "(app)/settings/historial/actions.ts",
  "(app)/settings/perfil/page.tsx",
  "(app)/settings/perfil/actions.ts",
  "(app)/settings/senders/page.tsx",
  "(app)/settings/senders/actions.ts",
  "(app)/settings/skills/page.tsx",
  "(app)/settings/skills/actions.ts",
];
