# Pasos manuales de la R32

Lo que tiene que hacer el responsable del proyecto. Ningún agente toca Neon, Vercel ni mergea. Informe de la tanda: `docs/beta/informe-r32.md`. Los pasos van **en este orden**: cada uno depende del anterior. Todas las fuentes quedan apagadas hasta que se cumplan los pasos de cada una.

## 1. Integrar la rama de cierre (carril rojo)

La tanda toca archivos del carril rojo, por eso el PR de cierre no lo mergea ningún agente: revisalo y mergealo en GitHub. Lista de la tanda (el lead la comprueba contra `gh pr diff <n> --name-only` y `.github/carril-rojo.txt`):

- **Base de datos:** `packages/db/schema.ts`; `packages/db/drizzle/0089_*`, `0090_*` y `meta/` (snapshots y journal); `packages/db/rls/0074_apertura_por_carrera.sql`; en `packages/db/src/`: `apertura-carreras.integration.test.ts` y `multiusuario.integration.test.ts`.
- **Acciones del servidor nuevas:** `apps/web/app/(app)/career-actions.ts` (`saveCareerPromptAction`, `dismissCareerPromptAction`), `apps/web/app/(app)/admin/carreras/actions.ts` (`setCareerOpenAction`) y `apps/web/app/(app)/jobs/few-offers-notice.tsx` (`dismissFewOffersAction`, inline).
- **Admin y acceso:** `apps/web/lib/admin-routes.ts`, `apps/web/lib/apertura.ts`.
- **Lectores de email:** `packages/adapters/src/inbound/` (`getonboard.ts`, `getonboard.test.ts` y `pool-computrabajo.test.ts`).
- **Otros archivos de R32-09 y R32-10:** `apps/web/app/api/cron/news-email/route.ts` y `apps/web/app/(auth)/novedades/baja/route.ts` (route handlers nuevos), `apps/web/app/(app)/settings/actions.ts`, `apps/web/lib/route-access.ts`, `packages/adapters/src/email/resend.ts` (campo opcional de headers), `apps/web/app/(app)/jobs/few-offers-notice.tsx` (server action inline, sumada a `carril-rojo.txt` y CODEOWNERS) y `apps/web/playwright.config.ts`.

Los e2e de `apps/web/e2e/` y el resto de lo de `docs/` y `apps/web` no son carril rojo.

## 2. Migraciones y RLS en Neon

Dos migraciones y una RLS, **en este orden**, cada una con su verificación de solo lectura antes de seguir. Aplicalas con el script de migraciones del repo contra Neon, confirmando con `si` como pide el script, y solo después de revisar el SQL. Nunca `db:seed`. **Aplicalas antes de desplegar el código:** `profiles` se lee con todas sus columnas en varios lugares, y sin las columnas nuevas esas consultas fallan.

| Orden | Pieza | Qué hace |
|---|---|---|
| 1 | Migración `0089_*` y RLS `0074_apertura_por_carrera.sql` | Tablas `open_careers` y `career_opening_events`, 4 columnas nuevas en `profiles` (`career_other`, `career_asked_at`, `news_email`, `news_email_sent_at`) y las funciones de la lista de carreras y de la baja del email. **Leé el paso 3 antes** |
| 2 | Migración `0090_*` | Valor `reliefweb` en el enum `source_kind`, 4 columnas nullable de sueldo original en `jobs` y en `public_jobs` y 2 checks. Sin RLS nueva |

**Antes de nada, confirmá que el rol que aplica la migración no es `jobsearch_app`** (las funciones y las policies `TO CURRENT_USER` de la 0074 dependen de eso). Solo lectura:

```sql
SELECT current_user AS rol_de_migracion;
SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname IN ('jobsearch_app', current_user);
```

`rol_de_migracion` tiene que ser distinto de `jobsearch_app`. Si es el mismo, frená y no sigas.

Verificación de solo lectura después de cada pieza:

```sql
-- Después de 0089 + 0074: tablas con RLS activa y forzada, columnas nuevas y funciones
SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
 WHERE relnamespace = 'public'::regnamespace
   AND relname IN ('open_careers', 'career_opening_events');                      -- true, true en las dos
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'profiles'
   AND column_name IN ('career_other', 'career_asked_at', 'news_email', 'news_email_sent_at');   -- 4 filas
SELECT proname FROM pg_proc
 WHERE pronamespace = 'public'::regnamespace
   AND proname IN ('careers_open_list', 'admin_career_set', 'admin_careers_open',
                   'admin_career_history', 'news_email_unsubscribe');             -- 5 filas
SELECT count(*) AS carreras_abiertas FROM open_careers;                           -- 0: la lista nace vacía

-- Después de 0090: valor del enum, columnas y checks
SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
 WHERE t.typname = 'source_kind' AND enumlabel = 'reliefweb';                     -- 1 fila
SELECT table_name, column_name FROM information_schema.columns
 WHERE table_name IN ('jobs', 'public_jobs') AND column_name LIKE 'salary_original_%'
 ORDER BY 1, 2;                                                                   -- 8 filas
SELECT conname FROM pg_constraint
 WHERE conname IN ('jobs_salary_original_shape', 'public_jobs_salary_original_shape');   -- 2 filas
SELECT count(*) FROM jobs WHERE salary_original_currency IS NOT NULL;             -- 0 al aplicarla
```

**Ojo con la 0090:** `ALTER TYPE … ADD VALUE` no se puede usar en la misma transacción en que se agrega el valor. La migración solo lo agrega y nada de ella lo usa, así que corre bien con el script; pero **no** insertes ni pruebes filas con `reliefweb` hasta que la migración haya terminado y confirmado. Después de aplicarla, nada cambia en la app: lo ya guardado queda con el sueldo original en null y la pantalla lo muestra como siempre.

## 3. Decisión antes de aplicar la 0089: `news_email` nace en `true`

La columna `profiles.news_email` se crea con `DEFAULT true NOT NULL`: al aplicar la 0089, **todas las cuentas existentes quedan inscriptas** en un email semanal de novedades que nunca pidieron. Mientras `NEWS_EMAIL` esté apagada (es el estado inicial) no se manda nada, pero la preferencia ya queda guardada.

Decidí antes de aplicar:

- **A. Dejarla en `true`** (opt-out). Antes de prender `NEWS_EMAIL`, los términos y Ajustes tienen que decirlo, y el email lleva la baja en un clic. Es lo que trae la migración.
- **B. Que nadie quede anotado** (opt-in, la opción más conservadora para el consentimiento). Dos formas:
  1. **Antes de aplicar:** pedile al lead que regenere la 0089 con `DEFAULT false` para las cuentas existentes (el SQL generado no se edita a mano). Después, el alta nueva puede nacer con `true` si el aviso queda a la vista.
  2. **Con la 0089 ya aplicada y antes de prender `NEWS_EMAIL`:** un `UPDATE` puntual. Mostrame el SQL completo antes de correrlo, y comprobá el resultado en la misma transacción:

     ```sql
     BEGIN;
     UPDATE profiles SET news_email = false WHERE news_email = true;
     SELECT count(*) FILTER (WHERE news_email) AS anotadas, count(*) AS total FROM profiles;   -- anotadas = 0
     COMMIT;   -- o ROLLBACK si no da 0
     ```

Con cualquiera de las dos, **no prendas `NEWS_EMAIL` hasta tomar esta decisión.**

## 4. Registrar las claves de Jooble y de ReliefWeb y probar cada fuente con `--dry-run`

Las dos están apagadas y no hacen ninguna llamada sin su clave. **Nada de esto se probó contra el servicio real.** Una a la vez; cada prueba se corre desde tu máquina (la clave va en tu entorno, nunca en el repo):

**Jooble (ADR-039).** Registrate como editor en Jooble, pedí la clave de la API y leé las condiciones de uso (retención, atribución, uso en un producto con cuentas): si alguna choca con el pool (retención de 30 días), no la prendas. Cargá `JOOBLE_API_KEY` en el entorno y corré:

```
pnpm pool:fetch jooble --dry-run
```

Hace 2 consultas del tope diario (100) e imprime solo conteos y qué campos trae la respuesta real; la URL, que lleva la clave, no se imprime. Contrastá «campos de la respuesta cruda» contra lo marcado «a verificar» en el ADR-039 (nombres y tipos, si `id` es número o texto, si `updated` trae zona, si `link` es el del portal de origen o uno de seguimiento). Si todo coincide, agregá `jooble` a `POOL_SOURCES` (de a una fuente). **No la prendas junto con Careerjet:** comparten `source_kind = other`. El detalle muestra «vía Jooble» con el link al aviso original, solo con sesión iniciada.

**ReliefWeb (ADR-028).** Pedí el identificador de aplicación (`appname`) siguiendo la documentación de la API de ReliefWeb (el registro lo hace el responsable, no un agente), cargá `RELIEFWEB_APPNAME` y corré:

```
pnpm pool:fetch reliefweb --dry-run
```

Hace hasta 2 pedidos, filtrados por Argentina y la región, y también verifica la forma del filtro por país (a verificar). Medí cuántos avisos remotos o de la región trae por semana antes de decidir si vale la pena mantenerla. **Tiene que estar aplicada la 0090** antes de agregar `reliefweb` a `POOL_SOURCES`. La atribución sale como «Fuente: ReliefWeb» con el link al aviso original.

**Computrabajo (ADR-043).** El lector está apagado (`POOL_COMPUTRABAJO_READER`) y se prende con el primer email real (paso 5).

## 5. Lista de alertas de Computrabajo que tiene que crear la revisora

La app no crea alertas ni navega portales (ADR-004): cada alerta la arma una persona por su cuenta. Para sumar inventario local, la revisora crea **una alerta por carrera** en Computrabajo (Argentina) con las palabras de la guía de alertas, y hace que esos emails lleguen a la casilla `pool-<carrera>@` del pool (con un filtro de Gmail que reenvía, como indica el asistente de reenvío de `/settings/asistente`).

| Carrera | Casilla | Palabras de búsqueda (una alerta por palabra, o la más específica primero) |
|---|---|---|
| Abogacía | `pool-abogacia@` | abogado · asesor legal · analista legal · paralegal · oficial de cumplimiento · analista de contratos |
| Contaduría y finanzas | `pool-finanzas_contabilidad@` | contador · contabilidad · analista impositivo · liquidación de sueldos · auditor interno · analista financiero |
| Administración de empresas | `pool-administracion_empresas@` | analista administrativo · analista de compras · analista de control de gestión · analista comercial · analista de procesos |
| Comunicación | `pool-comunicacion@` | analista de comunicación · comunicación institucional · comunicación interna · periodista · jefe de prensa · comunicación corporativa |
| Marketing digital | `pool-marketing_digital@` | marketing digital · community manager · seo · brand manager · trade marketing |
| Relaciones públicas | `pool-relaciones_publicas@` | relaciones públicas · ejecutivo de rrpp · relacionista público · relaciones institucionales · organizador de eventos |
| Relaciones internacionales | `pool-relaciones_internacionales@` | analista de comercio exterior · comercio exterior · cooperación internacional · relaciones institucionales · analista de importaciones · oficial de programas |
| Programación (full stack) | `pool-fullstack@` | full stack · desarrollador full stack · javascript · react · node |

Notas:
- Las palabras son las de la guía de alertas (`ALERT_KEYWORDS`); si una alerta trae demasiado ruido, acotala con la palabra más específica de la carrera. Computrabajo cubre mejor administración, finanzas, ventas, atención y RR.HH.; tecnología y legal, menos (estimación general: se confirma con las primeras alertas).
- Los pasos exactos de Computrabajo (alcanza con el email, sin cuenta) están en la guía, sin verificar contra el portal; si cambió su menú, el texto se ajusta en `alert-steps.ts`.
- **Hasta el primer email real** no prendas el lector: compará el esqueleto del log (misma huella o diferencias explicadas, ADR-043) y recién ahí `POOL_COMPUTRABAJO_READER=1`. Los emails que lleguen antes quedan en la cola manual del pool y se reprocesan después (`pnpm pool:reprocess`).
- Las casillas necesitan `POOL_SOURCE_COMPUTRABAJO_ALERTS=1` (independiente del lector).

## 6. Empresas regionales

La propuesta (25 filas por carrera, apagadas, todas «a verificar») está en `ops/rondas/r32-tanda/R32-06/propuesta/` y no va al repo. Los tokens son suposiciones: esperá que sirvan pocos. Para cada fila:

```
pnpm pool:fetch <proveedor> <token> --dry-run
```

Sirve la que responde, tiene al menos un aviso remoto y cae en una carrera de la beta (el comando informa conteos por carrera, sin títulos). Cargala de a una con `enabled = false` (SQL completo antes de correr y resultado pegado), y prendela recién después. Si da 404 o 0 avisos, se descarta. Los adaptadores que la R28 dejó apagados siguen apagados.

## 7. Qué mirar en `/admin/cobertura` para decidir la primera carrera, y cómo abrirla

`/admin/cobertura` (solo admins) muestra, por carrera de la beta: ofertas **vigentes** (la fuente las mostró en los últimos 7 días), **tomables** (aceptan Argentina, su región o todo el mundo de forma explícita, o el lugar de trabajo está en Argentina; sin países no cuenta), **para quien empieza**, **en español** y de qué fuentes vienen, con la tendencia de los últimos 14 días si los datos alcanzan.

- **Semáforo:** verde = al menos **30 tomables y 10 para quien empieza**; amarillo = la mitad o más de ambos; rojo = el resto. Solo informa.
- **Qué mirar:** (1) que los tomables lleguen al umbral con más de una fuente (una carrera que depende de una sola se cae si esa se apaga); (2) la tendencia: tomables nuevas por día que no sean cero; (3) el idioma: cuántas están en español; (4) que no sea un solo pico de un día.
- Una carrera abre cuando el responsable lo decide, con el semáforo en verde. `/admin/apertura` lee este mismo estado en su checklist.
- **Cómo abrirla:** `/admin/carreras` → la carrera → «Abrir». Queda en el historial quién y cuándo. **Con la lista vacía no se cierra nada a quien ya está adentro** y la alta nueva de cada carrera va a la lista de espera de esa carrera. «Otra» nunca abre. Para cerrarla, el mismo botón.
- Esto no cambia `BETA_OPENS_AT` ni `BETA_FECHA_DEFINITIVA`: la fecha la pone el responsable.
- **Alta con invitación:** una invitación no se frena por la lista (es una decisión explícita tuya). Si querés que además frene el alta de una carrera cerrada, es un cambio chico en `registerWithInvitation`.

## 8. Cumplir «Te avisamos por email apenas abra»

`/acceso` le promete un email a quien se anota de una carrera que todavía no abrió, **pero la app no lo manda sola** (no hay un envío automático a la lista de espera en esta tanda). Al abrir una carrera desde `/admin/carreras`:

1. Entrá a `/admin/invitations` («Invitaciones y lista de espera») y buscá a las personas anotadas con esa carrera.
2. Mandales la invitación desde ahí, como siempre.
3. Revisá que ninguna persona anotada de una carrera cerrada siga esperando después de que la abriste.

Hasta que haya un envío automático, no abras una carrera sin avisar a su lista de espera: la promesa de la pantalla queda sin cumplir.

## 9. Revisar los emails de Get on Board que fallaron

Los emails que el lector no entiende van a la cola manual con un motivo que **empieza con un código** (`docs/sources/getonboard.md` tiene la tabla). Para ver cuáles dominan, sin abrir su contenido (solo lectura):

```sql
SELECT split_part(split_part(error, '(getonboard): ', 2), ':', 1) AS codigo, count(*)
FROM inbound_emails
WHERE error LIKE 'estructura no reconocida (getonboard)%'
GROUP BY 1 ORDER BY 2 DESC;
```

- `sin_avisos` con `links` mayor que 0 y `tarjetas 0, destacados 0`: **el HTML cambió**. Guardá un email de ejemplo, sacale nombres y pasalo a una fixture pública (empresas y títulos inventados).
- `contrato_desconocido` o `seniority_desconocido`: el motivo cita el valor nuevo; alcanza con sumarlo a las listas del lector.
- `salario_ilegible`: el motivo cita el texto; se ajusta la lectura del sueldo.

Los emails reales no los lee ningún agente.

## 10. Lo no verificado

- **Todo servicio externo:** formato y condiciones de Jooble, ReliefWeb y Computrabajo; la forma del filtro por país de ReliefWeb; el menú de cada portal en la guía de alertas. Cada uno se comprueba con su `--dry-run` o con el primer email real.
- **Los ATS del pool solo guardan avisos remotos declarados.** Una empresa argentina con avisos presenciales o híbridos no suma al inventario aunque su board exista: esa vía rinde poco para «tomables en Argentina». Ampliarla es un ADR aparte (R33).
- **«Tomable» por lugar de trabajo** se lee del texto de la ubicación: `public_jobs` no tiene una columna de país del lugar de trabajo.
- **Las ofertas ya asignadas antes de la 0090 no tienen sueldo original**, y no se rellena nada a mano.
- **Tendencia de la cobertura:** cuenta tomables nuevas por día; no reconstruye «vigentes por día» (`last_seen_at` no guarda historia).
- **Hallazgos de la revisión de `alta`** (M1, L1 a L4): arreglados en la tanda; quedan M2 y M3 como decisiones (ver §3 y §8).
- **Email de novedades (R32-09):** no se mandó ninguno real. Para prenderlo: variables `NEWS_EMAIL` (`testers` primero), `NEWS_EMAIL_SECRET` (un valor largo y aleatorio, distinto del de los e2e) y `NEWS_EMAIL_DAILY_CAP`; sumar el paso semanal al `cron.yml` (carril rojo, lo hace el responsable); mandarse uno a una cuenta de prueba y probar la baja desde el email.
- **e2e:** corridos en local y verdes (ver el informe). Los de admin corren solos en el CI, donde la cuenta A es admin.
- **Archivos sueltos sin trackear para borrar a mano** (el guard no deja `rm`): `apps/adapters-placeholder` (de esta tanda) y `apps/web/app/(app)/jobs/loading.tsx` (de la R30).
