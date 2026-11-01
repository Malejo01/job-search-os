# Auditoría de seguridad de la beta cerrada (1/11/2026)

Revisión de punta a punta de lo que se agregó para cobrar y abrir la beta del 26/11, hecha por la nube (C5-5) leyendo el código y las migraciones de los PRs abiertos (#312 a #324 y los de C5). No se ejecutó nada contra producción ni contra Neon. Lo que se pudo probar sin Docker se validó con PGlite (migraciones 0000–0055 y `rls/*.sql` aplicados) y las pruebas de integración las corre el CI.

## Alcance y método

| Qué | Cómo se revisó |
|---|---|
| Migraciones 0048–0055 y sus RLS (`rls/0003`, `0006`, `0009`–`0015`) | Lectura del SQL; barrido automático de cada función `SECURITY DEFINER` (`search_path` fijo, `REVOKE` de `PUBLIC`, barrera `app_admins` donde devuelve datos de otras personas); el test `multiusuario.integration.test.ts` exige un caso por función |
| Páginas de admin: `/settings/planes`, `/settings/invitations`, `/settings/metricas` | Lectura de cada página, su `lib/*` y la función de base que usa; se comprobó que la decisión se toma en el servidor y en la base |
| Server actions nuevas y existentes | Barrido de las más de 50 funciones exportadas de archivos `"use server"`: sesión, validación y límites |
| Rutas `app/api/**` y middleware | Autenticación de cada ruta y lista de rutas públicas de `auth.config.ts` |
| Export CSV de la lista de espera | Columnas, autorización, cabeceras |
| Cron de avisos (`/api/cron/plan-notices`) | Autenticación, qué responde, qué loguea |
| Chip de soporte «¿Algo no anduvo?» | Qué se adjunta y adónde va |

## Resultado en una línea

No hay hallazgos críticos ni altos. Hay **dos hallazgos medios que ya tienen corrección en un PR** (M-1, M-2), **dos medios operativos** que dependen de configuración (M-3, M-4) y varios bajos o informativos. La separación entre personas (RLS por `user_id`, `FORCE ROW LEVEL SECURITY`) y la barrera de admin (ADMIN_EMAILS en la app + `app_admins` en la base) están bien aplicadas en todo lo nuevo.

## Hallazgos

| ID | Sev. | Hallazgo | Estado |
|---|---|---|---|
| M-1 | Media | **Los topes de la lista de espera bloquean la presentación del 11/11.** `waitlist_join` corta a 5 pedidos por hora por IP y 30 cada 10 minutos. En un salón con wifi compartido (una sola IP pública) o con datos móviles tras CGNAT, a la sexta persona se le niega el alta. | **Corregido en [#332](https://github.com/Malejo01/job-search-os/pull/332)** (40/h por IP, 60 cada 10 min, 600/día). Hay que aplicar `db:migrate` antes del evento |
| M-2 | Media | **El contexto del chip de soporte podía llevar títulos de ofertas y asuntos de emails de terceros.** `ActionTracker` guardaba el `textContent` del link más cercano (60 caracteres, solo se descartaba lo que tenía «@»), y los links al detalle de una oferta, un email o una postulación envuelven la tarjeta entera. Quedaba en `beta_feedback.context`, en el panel y en el email a `ADMIN_EMAILS`. | **Corregido en [#333](https://github.com/Malejo01/job-search-os/pull/333)**: etiqueta genérica para esos links, texto largo omitido, números largos y URLs reemplazados, y la misma limpieza en el servidor |
| M-3 | Media (operativa) | **El cupo de Resend (plan gratis: 100 por día) lo comparten usos sin presupuesto común.** Reseteos de contraseña, avisos de vencimiento (tope propio de 30, máximo 80, #320) y el email a admins de cada reporte de soporte (hasta 10 por persona por día × cantidad de direcciones de `ADMIN_EMAILS`). Con 20 personas activas y un par de admins, los reportes solos pueden pasar de 100 en un día malo, y el que pierde es un reseteo de contraseña o un aviso. | **Abierto.** Opciones: que el reporte llegue como un resumen diario (no uno por reporte), o un contador global por día en la base. Hasta entonces, `PLAN_NOTICE_DAILY_CAP` bajo (30) y una sola dirección en `ADMIN_EMAILS` |
| M-4 | Media (operativa) | **Sin `EMAIL_FROM` con dominio verificado, los emails salen del sandbox de Resend (`onboarding@resend.dev`), que solo entrega a la cuenta dueña.** El reseteo de contraseña falla en silencio para todas las demás personas (por diseño no revela errores). Los avisos de #320 ya exigen `EMAIL_FROM` y no mandan nada si falta. | **Abierto, es configuración.** Está en el runbook de apertura (C5-6). Probar un reseteo con una cuenta que no sea la dueña antes del 26/11 |
| B-1 | Baja | **El índice único `inbound_emails_email_id` (0052) es global, no por persona.** Si un mismo email de Resend llegara a dos cuentas, el segundo `INSERT … ON CONFLICT DO NOTHING` se descarta y esa persona pierde el email. No es una fuga (lo hace el rol dueño del webhook y el código solo reutiliza el id de la fila ganadora), y hoy cada reenvío de Gmail genera un `email_id` distinto. | **Abierto.** Corregirlo es una migración nueva (índice sobre `(user_id, email_id)`) más el cambio de `findByEmailId` en `inbound/handle.ts`; no lo hice para no sumar una migración a la tanda sin necesidad |
| B-2 | Baja | **Las páginas de admin responden con un mensaje («Tu cuenta no puede…») en vez de 404 a quien no es admin**, salvo `/settings/metricas`, que sí da 404. No expone datos: la decisión es del servidor y la base la repite. | Aceptado |
| B-3 | Informativa | **`auth_user_by_email` devuelve el hash de la contraseña a cualquier sesión del rol de la app** (el login necesita buscar al usuario antes de tener sesión). Lo fija un test «por diseño» (JS-103). Un SQLi o RCE en la app expondría todos los hashes (scrypt). | Riesgo conocido y documentado. A futuro: un rol de login aparte con ese único permiso |
| B-4 | Informativa | **No se verifica la propiedad del email al registrarse.** Una invitación «para cualquier email» deja registrar cualquier dirección. Las que salen de la lista de espera van atadas al email. | Aceptado para la beta cerrada (invitaciones a mano). Preferir siempre la invitación atada al email |
| B-5 | Informativa | **`ADMIN_EMAILS` es la primera barrera, `app_admins` la segunda.** Si se agrega a `ADMIN_EMAILS` el email de alguien que todavía no se registró, esa persona vería las pantallas de admin, pero la base (`app_admins`) le rechazaría todo. | Aceptado: la segunda barrera cubre el caso |
| B-6 | Informativa | **Las policies `profiles_definer_select` y `profiles_definer_update` (`TO CURRENT_USER`) permiten que cualquier función `SECURITY DEFINER` del dueño lea o cambie cualquier perfil.** Ya está advertido en los comentarios de `rls/0009` y `0015`. | El test de funciones exige un caso por cada función nueva; no sumar funciones sin revisarlas |
| B-7 | Informativa | **El firewall de Vercel (JS-108, 10 por minuto por IP) cubre `/login`, `/register`, `/setup`, `/forgot-password` y `/reset-password`, no `/acceso` ni `/settings/invitations/export`.** `/acceso` se protege solo en la base (M-1 ajusta esos topes). El export exige sesión de admin. | Aceptado; si el 11/11 hay tráfico raro, sumar una regla para `/acceso` |
| B-8 | Informativa | **El MCP resuelve a la persona por `MCP_USER_ID` o por `sole_user_id()`; con 2 o más cuentas sin `MCP_USER_ID`, falla cerrado.** No es una vulnerabilidad pero rompe el MCP de Mauro apenas se registre la segunda persona. | Está en el runbook (C5-6): definir `MCP_USER_ID` antes de invitar |
| L-1 | Informativa (legal) | **`docs/legal/datos-por-proveedor.md` no menciona los datos nuevos:** el email de aviso de vencimiento (Resend), `plan_source`, `plan_until` y `plan_notified_at`, `target_specialties`, el vínculo `waitlist.invitation_id` ni la retención de la lista de espera. Los textos legales esperan las respuestas del 13/11. | **Pendiente para el 13/11**: no se tocó ningún texto legal |

## Lo que se verificó y está bien

- **Migraciones 0048–0055.** Ninguna crea una tabla con datos de usuario sin RLS: 0048 y 0049 amplían un `CHECK` y suman skills (catálogo); 0050 suma `context` a `beta_feedback` (tabla con `user_id` y RLS desde antes) con tope de 4 KB; 0051, 0054 y 0055 son columnas de `profiles`, cubiertas por `profiles_owner`; 0052 y 0053 son de `inbound_emails` (con RLS) y el backfill es idempotente y no repite valores.
- **Plan inmodificable por la app.** El trigger `profiles_plan_guard` (rls/0010) rechaza que el rol de la app cambie `plan`, `plan_until`, `plan_source` o `plan_notified_at` (esta última, con #320, y con test de integración). El plan solo lo cambian `admin_plan_set` (con `app_admins`, origen `pago`/`beca` y fecha entre ahora y 400 días) o el dueño.
- **Funciones `SECURITY DEFINER` (22).** Todas con `SET search_path = pg_catalog, public`, `REVOKE ALL … FROM PUBLIC` y `GRANT` solo a `authenticated`. Las que devuelven datos de otras personas (`waitlist_admin_*`, `admin_beta_metrics`, `admin_founder_counts`, `admin_beta_feedback`, `admin_plan_*`) exigen `app_admins`. `career_maturity_stats` devuelve solo sí/no con k-anonimato.
- **Server actions.** De las revisadas, todas verifican sesión (`requireActiveUserId`, `requireUserId` o equivalente; las de `inbox/actions.ts` lo hacen en el helper `run`) salvo las públicas a propósito (`submitWaitlist`, con honeypot, Zod y tope en la base; y las de las pantallas de `login`, `register`, `setup`, `forgot-password` y `reset-password`). Las nuevas de admin (`grantPlanAction`, `revokePlanAction`, `inviteSelectedFromWaitlistAction`, `inviteFromWaitlistAction`, `deleteFromWaitlistAction`) validan entrada (email normalizado, `z.string().uuid()`, origen cerrado `pago|beca`, tope de 100 por tanda) y vuelven a chequear admin en el servidor.
- **Rutas `app/api/**`.** Los cinco crons y `/api/cron/status` exigen `Authorization: Bearer` comparado en tiempo constante (`checkBearerSecret` falla cerrado si falta `CRON_SECRET`); `/api/inbound` exige firma Svix; `/api/mcp` exige token (`MCP_TOKEN`, y `?token=` solo con `MCP_ALLOW_QUERY_TOKEN=1`); `assistant`, `cv-chat`, `cv/docx` y `gmail-filters` exigen sesión. El middleware deja públicas solo las rutas de la vitrina, de cuenta y legales.
- **Export CSV.** Solo nombre, email, carrera, origen y fecha (test y e2e lo comprueban); sin sesión devuelve 401, sin ser admin 403; `Cache-Control: no-store`; neutraliza fórmulas de planilla (`=`, `+`, `-`, `@`).
- **Cron de avisos.** Autenticado, idempotente (reclamo atómico sobre `plan_notified_at`), con tope diario, sin enviar nada si faltan `RESEND_API_KEY` o `EMAIL_FROM`; la respuesta que va al log público de Actions trae solo conteos y los logs, solo `user_id`.
- **Logs.** Se buscaron llamadas de log con `email`, `name` o `displayName` en `apps/web` y `packages/adapters`: ninguna escribe datos personales.
- **Chip de soporte.** El mensaje no se loguea, el contexto está acotado a 4 KB / 10 acciones, el HTML del email escapa todo (`escapeHtml`), hay tope de 10 reportes por persona por día con lock por persona, y las pantallas se anotan solo por `pathname` (sin query). Con M-2 corregido tampoco lleva textos de terceros.
- **Registro con lista de espera (C5-1, #326).** El vínculo con la carrera usa `waitlist.invitation_id` (la invitación borra su email al usarse) dentro de la función `SECURITY DEFINER` ya auditada; no devuelve ni escribe datos de otra persona (cubierto por el caso `register_with_invitation_v3` del test de funciones).

## Qué queda para Mauro

1. Aplicar `pnpm db:migrate` con #332 antes del 11/11 (M-1) y revisar los números.
2. Cargar `RESEND_API_KEY` **y** `EMAIL_FROM` (dominio verificado) y probar un reseteo con otra cuenta (M-4); decidir qué hacer con el presupuesto de Resend (M-3).
3. Definir `MCP_USER_ID` antes de invitar a la segunda persona (B-8).
4. Después del 13/11, actualizar `docs/legal/datos-por-proveedor.md` con los datos nuevos (L-1).
5. Decidir si vale la migración de B-1 (índice por persona) antes o después de la beta.

## Cómo repetir esta revisión

- Barrido de `SECURITY DEFINER`: leer cada `CREATE FUNCTION … SECURITY DEFINER` de `packages/db/rls/*.sql` y comprobar `SET search_path`, `REVOKE ALL … FROM PUBLIC` y, si devuelve datos de otras personas, `app_admins`. El test de integración ya obliga a tener un caso por función.
- Barrido de server actions: `grep -rl '"use server"' apps/web` y revisar que cada función exportada llame a `requireActiveUserId`/`requireUserId` antes de leer o escribir.
- Barrido de rutas: `find apps/web/app/api -name route.ts` y comprobar el mecanismo de autenticación de cada una contra `middleware.ts`.
