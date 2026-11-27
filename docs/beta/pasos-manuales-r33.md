# Pasos manuales de la R33

Lo que tiene que hacer el responsable del proyecto. Ningún agente toca Neon, Vercel ni mergea. Informe de la tanda: `docs/beta/informe-r33.md`. Los pasos van **en este orden**.

## 1. Integrar la rama de cierre (carril rojo)

La tanda toca archivos del carril rojo: el PR de cierre lo revisa y mergea el responsable. Lista (el lead la comprueba contra `gh pr diff <n> --name-only` y `.github/carril-rojo.txt`):

- **Base de datos:** `packages/db/schema.ts`, `packages/db/user-tables` (`src/user-tables.ts`), `packages/db/drizzle/0091_remarkable_killmonger.sql` con `meta/` (snapshot y journal), `packages/db/rls/0075_cv_drafts.sql`, y los tests `src/cv-drafts.integration.test.ts`, `delete-account.integration.test.ts` y `multiusuario.integration.test.ts`.
- **Route handlers nuevos:** `apps/web/app/api/cv/pdf/route.ts` (PDF) y `apps/web/app/api/cv-coach/borrador/route.ts` (borrador del coach). Cambia además `apps/web/app/api/cv-chat/route.ts` (acciones `resume` y `discard`) y `apps/web/app/api/cv/docx/route.ts` (lee las mismas opciones).
- **Server action nueva:** `apps/web/app/(app)/cv/links-actions.ts` (`saveCvLinksAction`, links del CV).
- **Pipeline `cv-*`:** `packages/pipeline/src/cv-draft/**`, `cv-screen.ts`, `cv-diagnosis.ts`, `cv-chat/**`, `cv-out/**`.
- **Adapters:** `packages/adapters/src/retention/cv-drafts.ts` (y su test de integración), `cv-chat/interview.ts` y `index.ts`.

Contra `.github/carril-rojo.txt`:
- **Rojos:** todo `packages/db/**` de la lista (schema, drizzle, rls, `src/`), los route handlers (`apps/web/app/api/**`), `links-actions.ts` (`*-actions.ts`), `packages/adapters/src/retention/**`, `packages/adapters/src/cv-chat/**`, `packages/adapters/src/applicant/context.ts`, `packages/adapters/src/worker/evaluate-job.ts` (log del stack), `apps/web/app/(app)/layout.tsx`, `apps/web/lib/cv-chat-server.ts`, `apps/web/lib/news-email.ts` (nuevo en la lista), `.gitleaksignore`, `.github/carril-rojo.txt` y `.github/CODEOWNERS`.
- **Verdes:** el pipeline (`cv-draft/**`, `cv-screen.ts`, `cv-diagnosis.ts`, `cv-chat/**`, `cv-out/**`), las pantallas y componentes del CV, `apps/web/lib/cv-draft.ts`, `cv-source.ts`, `textos-rediseno.ts`, los arreglos de listado y bandeja de R33-12 y los e2e.

El PR de cierre es rojo entero: lo mergea el responsable.

### 1b. Re-aplicar la RLS 0074 (arreglo de seguridad)

La R33 cambia `packages/db/rls/0074_apertura_por_carrera.sql`: quita el permiso de ejecutar `news_email_unsubscribe(uuid)` a `PUBLIC` y a `authenticated` (`REVOKE`), sin `GRANT` a la app. **Con la R32 sola cualquier cuenta autenticada podía dar de baja a otra del email de novedades.** Si la 0074 ya se aplicó en Neon con la versión de la R32, volvé a aplicarla (el script de RLS es idempotente) junto con la 0075. Verificación de solo lectura:

```sql
SELECT has_function_privilege('authenticated', p.oid, 'EXECUTE') AS sesion_puede
  FROM pg_proc p WHERE p.proname = 'news_email_unsubscribe';
-- Esperado: false
```

La baja desde el link del email sigue andando: la hace `apps/web/lib/news-email.ts` con el rol de servicio, después de verificar el token.

## 2. Migración 0091 y RLS 0075 en Neon

Una migración y una RLS, en este orden, solo después de revisar el SQL. Aplicalas con el script de migraciones contra Neon, confirmando con `si`. Nunca `db:seed`. Aplicalas **antes de desplegar el código**: sin ellas `/cv/armar` y el coach siguen funcionando, pero sin borrador.

| Orden | Pieza | Qué hace |
|---|---|---|
| 1 | Migración `0091_remarkable_killmonger.sql` | Tabla `cv_drafts` (una fila por persona y tipo: chat o coach), con los CHECK de tipo y de tamaño |
| 2 | RLS `0075_cv_drafts.sql` | `ENABLE` y `FORCE`, cuatro policies del dueño, permisos de la app |

Antes de empezar, confirmá que el rol que aplica no es `jobsearch_app`:

```sql
SELECT current_user AS rol_de_migracion;
SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname IN ('jobsearch_app', current_user);
```

Verificación de solo lectura después de aplicar:

```sql
-- La tabla existe con RLS activa y forzada
SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
 WHERE relnamespace = 'public'::regnamespace AND relname = 'cv_drafts';
-- Esperado: una fila con true y true

-- Policies del dueño
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'cv_drafts' ORDER BY cmd;
-- Esperado: una por cada comando (select, insert, update, delete)

-- Columnas y restricciones
SELECT column_name, data_type FROM information_schema.columns
 WHERE table_name = 'cv_drafts' ORDER BY ordinal_position;
SELECT conname FROM pg_constraint WHERE conrelid = 'cv_drafts'::regclass;
-- Esperado: user_id, kind, payload, created_at, updated_at; únicos por (user_id, kind); CHECK de kind y de tamaño; clave foránea a users con cascada

-- La tabla está vacía al aplicar (solo conteo)
SELECT count(*) FROM cv_drafts;
```

Si algo no coincide, frená y no despliegues.

## 3. Programar la purga de borradores (30 días sin uso)

`purgeStaleCvDrafts(db)` (`packages/adapters/src/retention/cv-drafts.ts`) está probada en integración y **no está programada**. Programala una vez por día: o se suma la llamada a la purga diaria que ya corre en `/api/cron/evaluate` (junto a `purgeExpired`), o se crea un cron propio. Sin este paso los borradores no se borran solos (el vencimiento se ve en la lectura, pero las filas quedan). **Decisión del lead (lo más simple):** sumar la llamada a la purga diaria de `/api/cron/evaluate`, junto a `purgeExpired`, en un PR aparte y revisado por vos (es carril rojo: ruta de cron). No se enganchó en la tanda para no tocar un cron en producción sin tu revisión.

## 4. Evals de los prompts nuevos de la tanda

**No hay prompts nuevos en la R33.** Los temas nuevos de los asistentes (resumen profesional, habilidades blandas, preguntas guiadas) los resuelve el código con las palabras de la persona, sin llamar al modelo; `cv_write@v1` sigue igual. No hay evals que correr ni nada que promover. Queda para la R34 la pregunta de fechas en el coach (C-62), que sí pide un prompt nuevo.

## 5. El PDF: abrirlo en tres lectores e imprimirlo (C-55)

No se pudo abrir el archivo en un lector real desde el entorno de los agentes; lo cubren pruebas de estructura (desplazamientos de la tabla de referencias, texto leído de vuelta, links). Pruébalo vos:

1. En `/cv`, con un CV con experiencia, estudios y al menos un link, tocá «Descargar PDF» (y «Descargar igual» si pregunta por lo que falta). El archivo se llama `CV-Nombre-Apellido.pdf`.
2. Abrilo en **tres programas** (por ejemplo, el visor del navegador, un lector de PDF de escritorio y el del celular). En cada uno: seleccioná y copiá un párrafo (tiene que pegarse como texto), mirá tildes y eñes, tocá un link (abre la dirección) y verificá que ninguna viñeta quede cortada entre dos páginas.
3. Repetí en inglés (opción «English») y con un CV muy corto y uno de dos páginas.
4. **Imprimí en papel real**: A4, márgenes parejos, nada cortado.
5. Abrí también el DOCX en Word, Google Docs y LibreOffice.

Si algo falla, anotá el programa y qué se ve; el ADR-049 explica cómo pasar a `pdf-lib` si hace falta otro alfabeto o fuentes incrustadas:

```
pnpm --filter @job-search-os/web add pdf-lib
```

(y escribir un adaptador en `apps/web/lib/` que recorra la composición; la composición no cambia).

Limitación conocida: el ritmo de descarga vive en memoria de cada instancia y casi no frena en Vercel. Un tope exacto pide una tabla con `user_id` y RLS.

## 6. Guion para que la revisora pruebe los dos caminos

Persona con la cuenta de prueba de la beta y el coach y el agente de perfil habilitados. Anotar en cada paso qué se entendió y qué no.

**A. «Tengo CV» (el coach)**
1. Entrá a «CV». Sin nada cargado tiene que verse solo la puerta («Tengo CV» / «No tengo CV»), sin listas de faltantes ni diagnóstico.
2. Tocá «Tengo CV» y subí un CV. Mirá: que diga que el archivo no se sube; que «Esto es lo que entendí» muestre los datos con «Sin completar» donde falta algo, y ejemplos que no parezcan datos reales.
3. En la revisión: quitá un trabajo (tiene que pedir confirmación y dejar «Deshacer»), agregá otro trabajo y un estudio, cambiá un idioma (el nivel viene explicado). Tocá «Guardar lo que elegí».
4. Abrí el coach desde el diagnóstico. Respondé una pregunta, saltá otra, volvé a la anterior. Cerrá la pestaña sin confirmar y volvé: tienen que reaparecer las propuestas pendientes, y nada tiene que estar en el CV sin tu clic.
5. En «Tu CV»: mirá el estado (parcial) y que cada faltante tenga su botón al campo exacto.

**B. «No tengo CV» (el chat de `/cv/armar`)**
1. Desde la puerta, tocá «No tengo CV». Mirá el mensaje de honestidad (corto, arriba), la privacidad en un ⓘ y el avance como lista de temas.
2. Respondé con «Responder y seguir»; probá «Saltear esta pregunta», «Volver a la pregunta anterior», y «Terminar y armar» (pide confirmación). Si usás el dictado, mirá que no envíe solo.
3. Contá un trabajo con tareas («ejecuté tareas de…»). Tiene que sugerir preguntas para pasar a logros, sin inventar cifras.
4. Dejá la charla a medias, salí y volvé a `/cv`: tiene que decir «Tenés un borrador sin confirmar» con «Retomarlo». Retomalo.
5. En «Esto es lo que entendí»: ejemplos, «Sin completar», habilidades como chips, idiomas con nivel, links. Tocá «Guardar y ver mi CV».

**C. En los dos caminos, ya con el CV armado (`/cv`)**
1. Diagnóstico: cada barra con palabra y número entero («Sólido · 9/10»…), la frase que dice que miden cómo lo lee un sistema automático, el ⓘ de cada barra, «Legibilidad» y «Largo» separados, y que cada «falta» traiga su botón.
2. Opciones: cambiá el idioma y fijate que la vista previa cambie sola. «Incluir ciudad y país» viene marcado y aclara que no es tu dirección. Guardá un LinkedIn con `http://` (tiene que rechazarlo sin repetir lo escrito) y uno con `https://` (tiene que mostrar «Abrir para probarlo» y aparecer completo debajo del nombre).
3. Mirá los títulos: en español todo en español («Habilidades», no «Skills»). Un trabajo en curso dice «Actualidad». El idioma dice «Inglés: A2, nivel básico». No debe aparecer ningún idioma ni dato que no cargaste.
4. «Para que tu CV se lea mejor»: aviso de habilidades que ninguna viñeta respalda (siguen en el CV) y preguntas sobre viñetas de tarea.
5. Tocá «Descargar PDF» y «Descargar DOCX» con un CV incompleto: tiene que preguntar «¿Completarlo antes?» con «Completar» y «Descargar igual». Descargá y comprobá que el archivo coincide con la vista previa.
6. Tomá nota de cualquier texto que suene a promesa, a predicción o a jerga.

## 7. Lo no verificado

- Los e2e 410, 420, 421, 428, 429 y 430 y los ajustados 85 y 86 están escritos y no se corrieron en la ronda de los teammates. **(completa el lead: resultado de la corrida.)**
- El PDF no se abrió en un lector real ni se imprimió (paso 5).
- El DOCX no se abrió en Word, Google Docs ni LibreOffice en esta tanda.
- La migración 0091 y la RLS 0075 solo se probaron en la base local con Docker, no en Neon.
- La purga de borradores no está programada ni probada en producción.
- Sin prompts nuevos: nada que medir con modelo real.
- La auditoría 431 y los e2e corrieron con `next dev` en la máquina local, de a un spec (memoria).
- Los textos del informe de revisión que cita la tanda se cotejaron con los IDs, no con una lectura de una persona real: la prueba del paso 6 es la primera.
- Ritmo de descarga: limitación en memoria, sin medir en Vercel.
