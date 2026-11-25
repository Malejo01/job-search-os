# Pasos manuales de la tanda R28 (25/11)

Lo que la tanda dejó listo en el repo pero tiene que hacer una persona. Informe: [`informe-r28.md`](informe-r28.md).

## 1. Orden de integración
Las 11 ramas van en cadena sobre `origin/ronda/r27-integracion` (`main` + la R27). Alcanza con integrar `ronda/r28-cierre`, que trae todo. Es **carril rojo**: migración 0083, `packages/db/schema.ts`, RLS 0068, `packages/db/src/**` y `apps/web/lib/apertura.ts`. No hay server actions nuevas: `carril-rojo.txt` y `CODEOWNERS` no cambian.

## 2. Migración 0083 y RLS 0068 en Neon
| Archivo | Qué hace |
|---|---|
| `packages/db/drizzle/0083_outgoing_bullseye.sql` | `source_kind` suma `recruitee` y `smartrecruiters`; el check de proveedores de `ats_boards` suma los dos |
| `packages/db/rls/0068_metricas_sin_is_test_por_fila.sql` | `admin_beta_metrics()` con el mismo resultado y otro cuerpo (de ~70 a ~4 ms con volumen). Idempotente. Para volver atrás, correr de nuevo `rls/0020_cuentas_de_prueba.sql` |

Las dos se aplican con `pnpm db:migrate` (pide confirmación). Ningún adaptador nuevo corre sin estar en `POOL_SOURCES`, así que el orden deploy/migración no rompe nada. Después, en una transacción de solo lectura:

```sql
BEGIN READ ONLY;
SELECT unnest(enum_range(NULL::source_kind))::text AS v ORDER BY 1;          -- incluye recruitee y smartrecruiters
SELECT pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conname = 'ats_boards_provider_check';                                 -- lista los 7 proveedores
SELECT prosecdef, position('is_test_user(' in prosrc) = 0 AS sin_llamada_por_fila
  FROM pg_proc WHERE proname = 'admin_beta_metrics';                          -- true, true
SELECT count(*) FROM ats_boards WHERE provider IN ('recruitee', 'smartrecruiters');  -- 0
ROLLBACK;
```

## 3. Fuentes nuevas (R28-05) y boards candidatos (R28-07)
- El equipo no puede abrir las APIs de Recruitee, SmartRecruiters, Workable ni Teamtailor (el guard solo deja `pool:fetch --dry-run` de Greenhouse, Lever y Ashby). El formato de los dos adaptadores nuevos sale de la documentación y está marcado «a verificar». Antes de prender cualquiera, correr una vez con un board real (solo lectura, sin base):
  - `pnpm pool:fetch recruitee <empresa> --dry-run`
  - `pnpm pool:fetch smartrecruiters <idEmpresa> --dry-run`
  
  Si los campos difieren de lo que lee el mapper, se ajusta en otra tanda. Para que el equipo pueda hacerlo solo, hay que sumar `recruitee|smartrecruiters|teamtailor|workable` a la lista de `pool:fetch` en `.claude/hooks/guard.mjs`.
- **Recruitee:** desde el **10/02/2027** su API pide un token que genera cada empresa (`X-Careers-Sites-Token`). Hasta entonces responde sin token. Después, el adaptador falla cerrado (ADR-046).
- `docs/beta/boards-candidatos.md`: 3 boards verificados, con los `curl` para los 4 proveedores sin verificar. El SQL está todo comentado y con `enabled = false`. Para cargar uno: descomentar la fila, repetir su `--dry-run` y recién ahí `update ats_boards set enabled = true where …`.
- Para prender una fuente: sumarla a `POOL_SOURCES` en Vercel.

## 4. Carreras no técnicas (R28-06)
- Medir la cobertura por carrera e idioma (el guard no deja correr el script nuevo, así que no se probó contra la base local):
  - base local: `pnpm pool:cobertura --local` (o `--local --db snapshot`);
  - producción, en solo lectura (usa `DATABASE_URL_APP`, o `DATABASE_URL` si falta): `pnpm pool:cobertura --solo-lectura`.
- La consulta de cobertura del 13/11 no está en el repo. El script sigue el criterio de `readPoolCoverage` (aviso activo = sin copias y visto en 30 días; celdas de 1 a 4 como «<5»). Si tenés la original, compará las dos salidas.
- Para aplicar las reglas nuevas a los avisos ya cargados: `pnpm pool:rehint` (en seco) y después `--apply --remote`.

## 5. Apertura (R28-03)
- `/admin/apertura` suma 4 ítems: términos del PR legal #552, voz en `all`, ruteo a Claude (contra `seeds/model_routing.json` y `sql/ruteo-s4.sql`) y fecha definitiva.
- Términos: queda pendiente hasta que `TERMS_VERSION` sea posterior a la de antes del #552. Mergear el #552 lo resuelve.
- Fecha: cambiar `BETA_OPENS_AT` (`packages/pipeline/src/plan-access.ts`) y poner `BETA_FECHA_DEFINITIVA = true` (`apps/web/lib/apertura.ts`).
- Voz: `VOICE_SERVER_TRANSCRIBE=all` en Vercel, después de que la política de privacidad tenga el texto de voz.
- Ruteo: aplicar `sql/ruteo-s4.sql` en Neon (pasos manuales de la S4).
- Links de Mercado Pago: el ítem ya existía (R22-05).

## 6. Borrar a mano (el guard no deja `rm`)
```bash
git rm apps/web/components/dictar.tsx apps/web/lib/beta-feedback-core.ts     # código muerto (R28-14)
rm apps/web/e2e/306-emails-con-afi.spec.ts                                   # sin trackear: lo reemplazó el 308
rm packages/pipeline/src/skills/zz-dump.test.ts                              # sin trackear: temporal de R28-06
rm ops/capturas/r27/.generar ops/capturas/r28/360/.generar ops/capturas/r28/afi-dice/.generar ops/capturas/r28/emails/.generar
rm ops/rondas/r28-tanda/.medir-lcp ops/rondas/r28-tanda/.volumen
```
Después de los `git rm`: `pnpm typecheck` y los tests de web.

## 7. Pruebas que quedan
- **En el CI** (en local se saltean por `ADMIN_EMAILS` o los precios): 276 (checklist), 278 pasos 6 y 7 («Ya pagué» y activación del admin), 299 (panel /admin con teclado). En local se pueden ver con `PRICING_ENABLED=1`, `MP_LINK_LISTA` inventado y `ADMIN_EMAILS` con el usuario de e2e.
- **Pendiente:** 295:19, el foco al abrir el modal de comentarios con Enter. Queda en `body`: hay un `key={formKey}` que remonta el formulario justo después de `showModal()`. Está marcado `fixme`.
- **A mano:**
  - emails de bienvenida y vencimiento en Gmail (web y app), Outlook y Apple Mail, en claro y oscuro, con imágenes bloqueadas;
  - un lector de pantalla real (NVDA) en la devolución de Interview y en el asistente;
  - Interview con el teclado del celular abierto;
  - el LCP de la portada contra un build (los e2e corren con `next dev`).
- **Capturas** (en `ops/`, no versionadas): `ops/capturas/r27/` (festejo y Hoy con el saludo), `ops/capturas/r28/afi-dice/`, `ops/capturas/r28/360/antes` y `ops/capturas/r28/360/despues`, `ops/capturas/r28/emails/`.

## 8. Decisiones pendientes
1. **Textos para aprobar** en `/settings/textos`: los de `AFI_DICE` (R28-15) y los 7 de `AYUDA_TEXTOS` (R28-12). La lista está en `docs/beta/textos-para-ani.md`. Hasta que se aprueben, la checklist los marca pendientes.
2. **Contacto público en `/ayuda`:** hoy solo nombra el botón «¿Algo no anduvo?». No hay canal para quien todavía no tiene cuenta.
3. **Festejo al activar el plan:** no existe. La propuesta está en `textos-para-ani.md` §R28.
4. **Ilustración del encabezado de Hoy:** se sacó para que quede un solo Afi. Si la querés de vuelta, va en otra tanda.
5. **Flags que quizás ya están en `all` en Vercel** (el equipo no puede leerlos): `START_HERE_ENABLED`, `HELP_TIPS_ENABLED`, `ACCESO_FUNNEL_ENABLED`, `FEEDBACK_TRIAGE_ENABLED`, `MARKET_CANDIDATES_ENABLED` y `CV_IMPORT_ENABLED`. Si están prendidas para todos, se puede limpiar la rama apagada.
6. **Botón flotante del asistente:** a 360 px tapa una esquina de algunas tarjetas (por ejemplo, la nota de afinidad en Match). Se dejó como estaba.
7. **Seguridad:** la revisión de R25 a R27 no encontró nada crítico, alto ni medio. Hay un ajuste opcional: ver `ops/seguridad/r28.md`.
8. **`docs/beta/preguntas-frecuentes.md`** quedó con las 10 preguntas viejas. La fuente real es `/ayuda`: actualizarlo o borrarlo.
