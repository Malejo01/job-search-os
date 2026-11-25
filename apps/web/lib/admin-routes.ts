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
  // Panel /admin (ADM-1): portada y personas; el layout de /admin también corta con 404
  "(app)/admin/page.tsx",
  "(app)/admin/personas/page.tsx",
  "(app)/admin/personas/[id]/page.tsx",
  "(app)/admin/invitations/page.tsx",
  "(app)/admin/planes/page.tsx",
  "(app)/admin/marca/page.tsx",
  "(app)/admin/marca/componentes/page.tsx",
  "(app)/admin/textos/page.tsx",
  "(app)/admin/metricas/page.tsx",
  "(app)/admin/salud/page.tsx",
  "(app)/admin/costos/page.tsx",
  "(app)/admin/apertura/page.tsx",
  "(app)/admin/feedback/page.tsx",
  "(app)/admin/informes/page.tsx",
  "(app)/admin/informes/[id]/page.tsx",
  "(app)/ui/page.tsx",
  // Rutas de descarga y de vista previa
  "(app)/admin/invitations/export/route.ts",
  "(app)/admin/feedback/export/route.ts",
  "(app)/admin/informes/[id]/export/route.ts",
  "(app)/admin/metricas/filtros-pool/route.ts",
  "(app)/admin/marca/email-bienvenida/route.ts",
  // Server Actions
  "(app)/admin/personas/[id]/actions.ts",
  "(app)/admin/invitations/actions.ts",
  "(app)/admin/planes/actions.ts",
  "(app)/admin/feedback/actions.ts",
  "(app)/admin/informes/actions.ts",
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
  // Revisión de Academy: admins y testers (no solo admins), con `canReviewAcademy` y 404 para el resto
  "(app)/settings/academy/page.tsx",
  "(app)/settings/academy/actions.ts",
  // Revisión de los textos del rediseño (R26-02): admins y testers, con `canReviewAcademy` y 404 para el resto
  "(app)/settings/textos/page.tsx",
  "(app)/settings/textos/actions.ts",
  // Recorrido para revisar (R26-03): también admins y testers, con `canViewRecorrido` y 404 para el resto.
  // Vive en /recorrido (no bajo settings ni admin), por eso el test del árbol no lo exige; se anota acá
  // para que quede junto a la otra pantalla de revisión.
  "(app)/recorrido/page.tsx",
  "(app)/settings/perfil/page.tsx",
  "(app)/settings/perfil/actions.ts",
  "(app)/settings/senders/page.tsx",
  "(app)/settings/senders/actions.ts",
  "(app)/settings/skills/page.tsx",
  "(app)/settings/skills/actions.ts",
];
