# Informe de la tanda R6 (12/11, noche)

La tanda R6 corrió mientras Mauro dormía. Tres agentes trabajaron en paralelo, cada uno en su worktree: rojo, imagen y pantallas. El lead revisó, commiteó, pasó la revisión de privacidad (más la de seguridad en R6-2 y R6-3) y abrió los PR. **Ningún PR se mergeó**: todos quedan en draft para Mauro.

Ningún PR de la R5 estaba mergeado, así que varias ramas salen de la rama de la R5 de la que dependen. Esos PR están apilados: su diff contra `main` incluye también los commits de la R5, y el cuerpo de cada uno dice «depende de #N».

## 1. PRs, en el orden de merge sugerido (después de los de la R5)

| Orden | PR | Ticket | Carril | Sale de | Antes de mergear |
|---|---|---|---|---|---|
| 1 | [#465](https://github.com/Malejo01/job-search-os/pull/465) | R6-1 · «+ Cargar oferta» siempre visible | verde | C9 (#458) | Después de #458 |
| 2 | [#467](https://github.com/Malejo01/job-search-os/pull/467) | R6-6 · anchos de los `loading.tsx` | verde | C6 (#456) | Después de #456 y #458 |
| 3 | [#466](https://github.com/Malejo01/job-search-os/pull/466) | R6-4 · restos de textos de la R5 | rojo por la base (su contenido es verde) | C8 (#461) | Después de #461 |
| 4 | [#468](https://github.com/Malejo01/job-search-os/pull/468) | R6-2 · criterios y disciplinas por carrera | **rojo** | C3 (#457) | Después de #457. Migración 0062 (§4) |
| 5 | [#469](https://github.com/Malejo01/job-search-os/pull/469) | R6-5 · skills propias de RR.PP. | **rojo** | R6-2 (#468) | Después de #468. Migración de datos 0063 (§4) |
| 6 | rama `ronda/r6-3-imagen`, **sin PR** | R6-3 · oferta desde una imagen | **rojo** | `main` | Abrir el PR (§5, paso 2) y aplicar la fila de `model_routing` |
| 7 | este PR | Cierre de la R6 | verde | cierre de la R5 (#464) | Al final, después de #464 |

La rama de R6-5 salió de R6-2 antes del último ajuste de R6-2 (c0fa489). No es un problema: R6-5 no toca esos archivos y, mergeando primero #468, el diff de #469 queda limpio.

## 2. Cómo se probó cada uno

| Ticket | Pruebas |
|---|---|
| R6-1 | Typecheck en 0; eslint y prettier limpios; pipeline y adapters verdes. e2e 130 nuevo (con oferta elegida a 1280 px y sin scroll a 390 px): lo corre el CI. |
| R6-2 | Tests primero, con fixtures inventadas de las 8 carreras (`criterios-carreras.test.ts`); pipeline: 4458 tests. Migración 0062 generada con drizzle-kit, aplicada en la base local con `local.mjs migrate`; integración de db: 434 de 434. Revisión de seguridad: OK con observaciones; la A (avisos etiquetados `data` en contaduría y administración) se arregló en c0fa489. |
| R6-3 | Tests primero en pipeline (esquema, «no es un aviso», 13 salidas inválidas, instrucción escondida); adapters: 954 tests (imágenes que no van ni a `llm_calls` ni al log, candado, topes); prompts y db: verdes. Revisión de seguridad: el P1 (topes que se saltaban con llamadas en paralelo) se arregló con un candado de transacción por persona; S5 y S6 también se arreglaron, y S2 y S3 quedan anotados en el PR. e2e 129 con el modelo en demo: no corrió local (§3); tiene que correr en el CI cuando se abra el PR. |
| R6-4 | Typecheck en 0; pipeline: 4411 tests (`alertKeywordsFor([])` devuelve `[]`); grep sin e2e que busquen los textos viejos. |
| R6-5 | Pipeline: 4461 tests; db unitarios: 138. Migración de datos 0063 generada con `drizzle-kit generate --custom`, aplicada local; integración de db: 437 de 437 (la migración inserta lo mismo que el seed y es idempotente). |
| R6-6 | Typecheck en 0; eslint y prettier limpios en los 4 archivos. El e2e 125 mide `main#contenido` y no cambia. |

Todos: revisión de privacidad con veredicto PASA antes de cada push, y el pre-push sin hallazgos. Los 3 tests de symlinks de `privacy-scan.test.ts` fallan en Windows; en el CI pasan.

## 3. Qué quedó afuera y por qué

- **Los e2e no corrieron en local.** La base local no tiene el usuario de e2e. El seed local cargaría `fixtures-private/` (datos reales) salvo con `SEED_FIXTURES=example`, y el guard no deja poner variables delante de un comando. Quedan para el CI de cada PR.
- **El PR de R6-3 no está abierto.** El prompt nuevo vive en `packages/prompts/`, y todo PR que toca esa carpeta corre el job `evals` del CI: 16 llamadas al evaluador vigente, unos USD 0,16 por push y tope de 0,5. No miden nada de este ticket y no había OK para ese gasto. La rama está pusheada (un push sin PR no corre el CI).
- **Worktrees:** el guard bloquea `git worktree add/remove`. Se reusaron los de la R5 (`jso-rojo`, `jso-qa` y `jso-pantallas`), cambiando de rama adentro. Borrarlos queda para Mauro (§5).
- **R6-6, base que junte C6 y C9:** `git merge` está prohibido para los agentes. La rama sale de C6, donde viven los `loading.tsx`, y les pone a mano los anchos de C9.
- **R6-2 sin medición con el modelo real.** El arreglo no toca el prompt. Las listas por carrera incluyen siempre `otra` y `negocio`, que es lo que hoy emite el evaluador (v1.3) para avisos no tech. Si Mauro quiere confirmarlo, el mismo subset del CI: `pnpm evals run --prompt vigente --subset --runs 1 --concurrency 1 --db none --max-usd 0.5`, unos USD 0,16 con el ruteo de `main`. Ojo: ese subset mide sobre todo que no haya regresión; para medir el arreglo hacen falta casos de las carreras no tech.
- **R6-2, precondición a futuro:** antes de activar un prompt que emita las 5 disciplinas nuevas, la 0062 tiene que estar en Neon (si no, el insert en `evaluations` falla). Mergear sin aplicarla es seguro hoy: `allowed_disciplines` vive en jsonb.
- **R6-3, límites conocidos** (revisión de seguridad, P2): el tope cuenta intentos, no imágenes (con el modelo de respaldo, una imagen puede contar 2); del JPEG solo se validan los primeros bytes; la imagen viaja a Google y, de respaldo, a Anthropic, y puede traer datos de terceros.
- **Bloqueadas, sin arrancar:** C5 (legales, espera las respuestas 1, 2, 3 y 6) y el parser de Bumeran (espera un `.eml` real).

## 4. Migraciones sin aplicar

| Migración | PR | Qué hace | Cuándo |
|---|---|---|---|
| `0061_carrera_relaciones_publicas.sql` + `rls/0012` | #457 (R5) | `waitlist_role_check` y `admin_founder_counts()` suman `relaciones_publicas` | Antes de mergear #457 |
| `0062_disciplinas_carreras_no_tecnicas.sql` | #468 | `ALTER TYPE discipline ADD VALUE` × 5 (como la 0022) | Antes de mergear #468 (hoy es inocua, pero así el enum queda al día) |
| `0063_skills_relaciones_publicas.sql` | #469 | Alta de 4 skills (`INSERT … ON CONFLICT`, idempotente) | Antes de mergear #469: si no, RR.PP. no ve sus skills nuevas en producción |

`pnpm db:migrate` aplica las migraciones pendientes en orden, y después las RLS. Corrido una vez desde la rama de #469 (que trae la 0061, la 0062 y la 0063), aplica todas de una.

## 5. Pasos manuales para Mauro, en orden

1. **Los PR de la R5 primero**, según `docs/beta/informe-r5.md` §1 y §5.
2. **R6-3: decidir el PR.**
   - (a) Abrirlo aceptando unos USD 0,16 por push en evals: `gh pr create --draft --base main --head ronda/r6-3-imagen --title "[R6] R6-3 · cargar una oferta desde una imagen · carril rojo" --body-file ops/rondas/r6-tanda/R6-3/pr-body.md`.
   - (b) Dejarlo para después de la beta. Es la opción más conservadora y la que queda si no decidís.
3. **Migraciones en Neon** (§4), después de revisar el SQL: desde la rama `ronda/r6-5-skills-rrpp`, `pnpm db:migrate` (pide `si`). Aplica la 0061, `rls/0012`, la 0062 y la 0063.
4. **Mergear los PR de la R6** en el orden de §1.
5. **Si mergeás R6-3:** aplicar la fila `extract_job_from_image` en `model_routing` con el SQL y la guarda de `docs/beta/pasos-manuales-r6.md` §1 (ensayo primero, después aplicar), y revisar si los textos legales cubren que la imagen viaje al proveedor del modelo.
6. **Después del deploy de C3:** `pool:rehint`, como en la R5.
7. **Borrar los worktrees** (el guard no deja a los agentes):
   - `! git worktree remove --force C:/wt/jso-pantallas`, y lo mismo con `jso-qa` y `jso-catalogos`;
   - si falla: `! cmd /c rmdir /s /q "\\?\C:\wt\jso-qa"` y después `! git worktree prune`;
   - `jso-rojo` queda para C5.
8. **Decisión de producto (R6-2):** las listas de disciplinas por carrera están en `CAREER_DISCIPLINES` (`packages/pipeline/src/onboarding.ts`). Ante la duda se eligió no descartar: todas incluyen `negocio` y `otra`, y administración incluye RR.HH., atención al cliente y datos. Si querés acotar, es una línea por carrera.
