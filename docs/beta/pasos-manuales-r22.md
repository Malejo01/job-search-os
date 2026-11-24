# Pasos manuales de la tanda R22

Todo lo de esta lista lo hacés vos: ningún agente toca Neon ni Vercel. El orden importa: primero las migraciones, después las RLS (las corre el mismo `db:migrate`) y recién ahí desplegar.

## 1. Migraciones 0076 y 0077 (Neon)

| Archivo | Qué crea | Ticket |
|---|---|---|
| `packages/db/drizzle/0076_slimy_monster_badoon.sql` | Tabla `payment_notices` y 5 índices por fecha: `applications_created_at`, `evaluations_created_at`, `evaluations_verdict_at`, `interview_sessions_created_at`, `jobs_manual_created` | R22-01 y R22-04 (se generaron juntos) |
| `packages/db/drizzle/0077_vengeful_living_lightning.sql` | Tabla `plan_events` (historial del plan) | R22-02 |

- Las dos son solo `CREATE TABLE`, `CREATE INDEX` y claves foráneas: no cambian tablas existentes ni mueven datos.
- Los 5 índices se crean sin `CONCURRENTLY`: con las tablas chicas de la beta tardan segundos, pero bloquean escrituras mientras se crean. Mejor aplicarlas en un horario sin uso.
- Antes de correrlas, revisá el SQL generado. Después corré `pnpm db:migrate` contra Neon, que pide escribir `si`.
- Si la base es de otra integración (R19, S5, R20): **no** traen migraciones, así que la numeración no choca.

## 2. RLS 0053, 0054 y 0057 (las aplica el mismo `db:migrate`)

| Archivo | Qué hace |
|---|---|
| `rls/0053_payment_notices.sql` | La persona lee e inserta solo sus avisos, siempre como `pendiente`. Sin policy de UPDATE ni DELETE. Trigger con lock por persona: tope de 3 pendientes |
| `rls/0054_cola_de_altas.sql` | `plan_events` sin acceso de la app. Funciones de admin (`SECURITY DEFINER` con la barrera `app_admins`): listar la cola, activar, rechazar y anotar y listar el historial |
| `rls/0057_uso_por_carrera.sql` | Función `admin_usage_by_career()`: el uso por carrera y semana, sin celdas de menos de 3 personas |

- La 0057 tiene ese número porque el guard no deja renombrar archivos; la 0055 y la 0056 quedan libres para la R21.
- Para volver atrás (sin filas todavía): `DROP TABLE plan_events; DROP TABLE payment_notices;` y `DROP FUNCTION` de las funciones nuevas. Los índices se pueden dejar.

## 3. Cómo probar el circuito «Ya pagué → Activar»

Hace falta `PRICING_ENABLED=1` y el link de pago (`MP_LINK_LISTA`) cargados en el entorno donde pruebes, y tu cuenta en `ADMIN_EMAILS` y en `app_admins`.

1. Con una cuenta de prueba (no la tuya), en **Ajustes → Tu plan**, debajo de «Pagar con Mercado Pago», cargá un número de operación inventado (solo dígitos) y tocá **«Ya pagué»**. Tiene que decir «Recibimos tu aviso: lo confirmamos a mano en menos de 24 h».
2. Repetí hasta tener 3 pendientes: el formulario desaparece y explica el tope.
3. Con tu cuenta de admin, en **`/settings/planes`**, arriba aparece la cola con fecha, plan, número de operación y email.
4. **«Activar 30 días»** en uno: la persona pasa a tener el plan como pago (y le llega la bienvenida si `WELCOME_EMAIL_ENABLED=1`). El aviso sale de la cola. Un segundo clic dice «ya resuelto» y no suma días.
5. **«Rechazar»** otro con un motivo corto: sale de la cola.
6. Al pie, «Últimos cambios» muestra la activación y el rechazo, sin emails.
7. Probá la búsqueda por email, los filtros («Vencen en 7 días», «Vencidos», «Pendientes») y «Renovar +30 días» en una fila.

La app no habla con Mercado Pago: confirmar que el pago se acreditó lo hacés vos en Mercado Pago antes de tocar «Activar».

## 4. Recordatorios de vencimiento

- Sin migración ni variables nuevas. El cron `/api/cron/plan-notices` ya existe; ahora manda hasta 3 emails por vencimiento (a 7 días, a 1 día y el día), con la misma marca `plan_notified_at`.
- El aviso dentro de la app empieza 7 días antes, en vez de 3 (`EXPIRY_WARNING_DAYS`).
- El envío sigue gobernado por `RESEND_API_KEY` y `EMAIL_FROM`.

## 5. Checklist de apertura (`/settings/apertura`)

- Sin migración ni variables nuevas. Abrila antes de abrir la beta y seguí lo que marque como pendiente.
- **Textos de Ani:** desde la R26 se aprueban desde la app (`/admin/textos` o `/settings/textos`) y la checklist los cuenta desde la base. La lista `TEXTOS_REDISENO_APROBADOS` ya no existe (ver [`pasos-manuales-r26.md`](pasos-manuales-r26.md)).
- **Mascota:** busca los PNG en `apps/web/public/mascota/`, que todavía no existe.

## 6. e2e que corren solo con variables

El guard no deja prender variables delante del comando, así que estos specs se saltearon en local:

| Spec | Qué necesita |
|---|---|
| 157 «Ya pagué» | `PRICING_ENABLED=1` y `MP_LINK_LISTA` |
| 160 vencimiento | `PRICING_ENABLED=1` |
| 161 checklist, 164 uso por carrera y 165 cola de altas | `ADMIN_EMAILS` y el usuario del seed |

Para correrlos a mano: `PRICING_ENABLED=1 pnpm e2e:local 157 160` y, con la base sembrada, `pnpm e2e:local 161 164 165`.
