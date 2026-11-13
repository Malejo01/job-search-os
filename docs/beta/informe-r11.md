# Informe de la Tanda R11 (13/11, noche)

Cinco teammates (perfil, portales, seguridad, cargas y auditoria) más el lead. Base: `main` con la integración de la R8, la R9 y T-1 (#505). La R10 entra en esta tanda a través de #514. Todo queda en PR draft y **ningún PR está mergeado**. Los tickets R11-9 a R11-13 salen de la auditoría de primer uso (`docs/beta/auditoria-primer-uso-13-11.md`).

## 1. PR en orden de merge

| # | PR | Ticket | Carril | Depende de | Migración o SQL |
|---|---|---|---|---|---|
| 1 | [#506](https://github.com/Malejo01/job-search-os/pull/506) | R11-6 · rol de admin en settings | rojo | — | — |
| 2 | [#512](https://github.com/Malejo01/job-search-os/pull/512) | R11-7 · costo de llamadas fallidas, columnas de `users`, test-users, skeleton | rojo | — | `rls/0021` (sin aplicar) |
| 3 | [#507](https://github.com/Malejo01/job-search-os/pull/507) | R11-9 · skills con evidencia y carrera con señal en el título | rojo | — | después: `pool:rehint` y `skills:extract --pool` |
| 4 | [#509](https://github.com/Malejo01/job-search-os/pull/509) | R11-11 · detalle de oferta coherente | rojo | #507 (apilado) | — |
| 5 | [#508](https://github.com/Malejo01/job-search-os/pull/508) | R11-3 · parser de Bumeran (rama `-v2`) | rojo | — | — |
| 6 | [#510](https://github.com/Malejo01/job-search-os/pull/510) | R11-4 · parser de Computrabajo | rojo | #508 (apilado) | — |
| 7 | [#515](https://github.com/Malejo01/job-search-os/pull/515) | R11-5 + R11-10 · guía de alertas, portada y onboarding honestos | verde | — | — |
| 8 | [#511](https://github.com/Malejo01/job-search-os/pull/511) | R11-12 · CV sin autocrítica | rojo | — | — |
| 9 | [#513](https://github.com/Malejo01/job-search-os/pull/513) | R11-13 · celular, Contaduría para Argentina y P2 | rojo | — (choca con #511 en `start-here.tsx`) | `R11-13/catalogo-neon.sql` (en `ops/`) |
| 10 | [#514](https://github.com/Malejo01/job-search-os/pull/514) | R11-1 + R11-2 · agente de perfil integrado (trae la R10 entera) | rojo | — (choca con #507 en `plan.ts`) | fila `extract_cv_profile` de `model_routing` (SQL en el PR) |
| 11 | R11-8 · indicador de carga sin streaming (rama pusheada, **sin PR**) | verde | — | — |
| 12 | este PR · cierre | verde | va último | — |

**#514 reemplaza a #497–#504**, los PR de la R10. Se rehízo como un solo commit sobre `main` porque los commits viejos de la R10 no pasan el barrido de privacidad actual (patrón #137). Al mergear #514, esos ocho se cierran.

## 2. Ramas para la integración (exactas)

```
ronda/r11-6-rol-admin
ronda/r11-7-deuda-seguridad
ronda/r11-9-skills-pool
ronda/r11-11-detalle            (contiene r11-9)
ronda/r11-3-parser-bumeran-v2
ronda/r11-4-parser-computrabajo (contiene r11-3-v2)
ronda/r11-5-guia-alertas        (R11-5 + R11-10)
ronda/r11-12-cv-resumen
ronda/r11-13-celular-contaduria
ronda/r11-1-agente-perfil-v2    (R10 + R11-1 + R11-2)
ronda/r11-8-carga-cliente
ronda/r11-cierre
```

No usar `ronda/r11-1-agente-perfil` ni `ronda/integracion-r10-base`: tienen la historia vieja. `ronda/r11-3-parser-bumeran`, la v1, quedó solo local.

**Conflictos esperados al integrar:**
- **#507 y #514:** chocan en `packages/pipeline/src/skills/plan.ts`, `plan.test.ts` y `packages/adapters/src/market/plan.ts`. Hay que conservar las dos reglas:
  - R11-9: `filterPlanByCareer` saca las skills de otra familia antes de armar el plan.
  - R11-2: `planItemsToRemove` borra solo la pendiente cuya skill la persona ya domina.
- **#511 y #513:** líneas contiguas de `STEP_TASK` en `apps/web/app/(app)/hoy/start-here.tsx`. Es un conflicto solo de texto.
- **`docs/BACKLOG.md`:** #514 trae el Bloque 24 (R10) y este cierre agrega el Bloque 25 al final. Es un conflicto de agregado al final: van los dos, el 24 primero.
- **`parsers.ts` y `filter-leak.ts`:** #508 y #510 están apilados, sin conflicto entre sí.
- **Portales automáticos:** al integrar R11-5 con #508 y #510, agregar `"bumeran"` a `AUTOMATIC_PORTAL_IDS` e invertir el test `isAutomaticPortal("bumeran")`. Computrabajo **no** se agrega hasta que llegue un aviso real (`COMPUTRABAJO_RECOMMENDED`).
- **Agente de perfil y «Subir tu CV»:** con #514 adentro, el paso de Hoy que R11-12 cambió a «Armar tu CV con IA» puede apuntar al agente para quien tenga el flag prendido.

## 3. Qué hizo cada ticket

- **R11-1 + R11-2 (#514):**
  - una sola puerta del flag `CV_PROFILE_AGENT` (sesión → flag → ticket → tope) y una sola medición de gasto, que cuenta las llamadas fallidas;
  - una recarga no gasta otra lectura del cupo: la propuesta queda en la pestaña, atada al ticket, y el servidor revalida al guardar;
  - la guía recibe los puestos sugeridos, y el resumen del onboarding sale del perfil guardado;
  - e2e 135 del recorrido completo con el modelo en demo, y `.gitleaksignore`;
  - `plan:build` ya no borra una skill sumada desde la guía;
  - criterios y perfil se guardan en una transacción;
  - un reintento de la redacción del cierre;
  - el tope por persona y día se mide dentro del lock.
- **R11-3 (#508):** parser de «Bumeran te sugiere», que falla cerrado. El ruteo es por dominio y se prueba sin direcciones. No guarda URL ni ID del aviso: el link del mail es un tracker con un id de la persona. ADR-035.
- **R11-4 (#510):** parser de recomendaciones de Computrabajo, que saca el ID y la URL pública del aviso del tracker. Los recordatorios y el «la empresa vio tu CV» devuelven `{ ok: false }`. ADR-037.
- **R11-5 + R11-10:**
  - **Guía:** cubre 5 portales visibles, y solo dicen «automático» los que tienen lector en `main`. Computrabajo no se recomienda.
  - **ADR-036 (propuesto, sin código):** pool de Bumeran. Recomienda no publicarlo por ahora, porque falta el link al original.
  - **Un solo mensaje:** el cierre del onboarding y la guía nombran los portales por carrera.
  - **Pocas ofertas:** con menos de 5 ofertas en el idioma de la persona, el mensaje lo dice y ofrece cargar una oferta.
  - **Portada:** el conteo sale de una consulta agregada (8 carreras de la beta y cuántas en español), sin el hueco y con una línea por paso.
- **R11-6 (#506):** un helper y una lista de rutas de admin, con un test que recorre `app/`. Los huecos reales eran `revokeInvitationAction` sin comprobación y el 403 de `invitations/export`.
- **R11-7 (#512):**
  - las llamadas fallidas cuentan para los topes en USD (USD 0,01 si el proveedor no informa el uso);
  - `rls/0021` deja el UPDATE de `users` solo en 5 columnas;
  - `admin:test-users` usa el criterio real de onboarding, y `--remote` pide los datos explícitos;
  - `inbound:skeleton` enmascara lo que sigue a un saludo, también con entidades HTML.

  La revisión de seguridad dio OK con observaciones, y las 6 entraron en un segundo commit.
- **R11-8 (sin PR):** `useLinkStatus` en los links de la barra y las pestañas: una línea fina y `aria-busy`, sin `loading.tsx` ni `<Suspense>`. Se pierde el esqueleto del contenido, y el documento `docs/beta/carga-sin-streaming.md` explica por qué.
- **R11-9 (#507):**
  - unos 60 términos ambiguos exigen contexto en una JD;
  - las categorías amplias de WWR no asignan la carrera sin señal en el título;
  - el plan no propone skills de otra familia salvo 5 menciones y 25 % de la más pedida;
  - `skills:extract --pool` con dry-run y fallo cerrado.
- **R11-11 (#509):**
  - los requisitos cuentan los excluyentes de la evaluación;
  - un solo mapeo de etiquetas internas;
  - los riesgos que contradicen un excluyente salen de «se ven, no frenan»;
  - en celular, el veredicto va arriba y «Postularme» se oculta si el veredicto es descartarla.
- **R11-12 (#511):** el CV no copia el resumen del perfil, y «Subir tu CV» pasa a «Armar tu CV con IA». El chat de CV toma el puesto del perfil y arranca en 1. Sin migración.
- **R11-13 (#513):**
  - «¿Algo no anduvo?» ya no tapa contenido en celular (e2e 138) y «Primeros pasos» va en una línea;
  - el catálogo de Contaduría suma software y trámites de Argentina;
  - «Client-facing» pasa a «Trato con clientes y explicar a personas no técnicas»;
  - P2 12, 20, 23 y 25.

### Tabla antes/después de R11-9 (avisos inventados)

| Carrera | Skills espurias antes → después |
|---|---|
| Abogacía | 0 → 0 |
| Contaduría | 2 → 0 |
| Administración | 0 → 0 |
| Comunicación | 0 → 0 |
| Marketing | 0 → 0 |
| Relaciones públicas | 0 → 0 |
| Relaciones internacionales | 0 → 0 |
| Programación | 3 → 0 |

El pool real no se midió (está en Neon). El dry-run `pnpm skills:extract --pool` contra el snapshot da el número real.

## 4. Gasto de evals

Tope de la tanda: USD 3. Solo #514 toca `packages/prompts/`, porque trae los prompts de la R10: una corrida al abrirlo, ~USD 0,16. Ningún otro PR toca prompts, y sus jobs de evals terminaron en segundos sin costo. **Total: ~USD 0,16.**

## 5. Pasos manuales para el dueño del proyecto

1. **Archivo suelto en la carpeta principal:** borrar `docs/beta/carga-sin-streaming.md`, que no está trackeado. Es una copia que escribió un teammate por error. Mientras exista, git no deja cambiar a `ronda/r11-8-carga-cliente` y el PR de R11-8 no se puede abrir. Después: `git switch ronda/r11-8-carga-cliente` y `node .claude/bin/pr.mjs --title-file ops/rondas/r11-tanda/R11-8/pr-title.txt --body-file ops/rondas/r11-tanda/R11-8/pr-body.md`.
2. **Neon (después de revisar cada SQL):**
   - `rls/0021_users_self_update_columnas.sql` (#512). La verificación con `has_column_privilege` está en el PR.
   - La fila `extract_cv_profile` de `model_routing`. El SQL, con guarda, está en #514.
   - `ops/rondas/r11-tanda/R11-13/catalogo-neon.sql` (#513) y después `pnpm skills:extract --all`.
   - Después de #507: `pnpm pool:rehint` y `pnpm skills:extract --pool`, primero en dry-run contra el snapshot y después con `--apply`.
3. **Vercel**, cuando se quiera abrir el agente a testers: `CV_IMPORT_ENABLED=1` y `CV_PROFILE_AGENT=testers`.
4. **`pdfjs-dist`** (opcional): el comando y el código están en `ops/rondas/r11-tanda/R11-1/pdf-pendiente/`. Hay que verificar la versión antes, porque el guard no dejó consultarla.
5. **Cerrar PR:** #497–#504 al mergear #514, y #483, que ya estaba reemplazado.
6. **Ramas públicas con el nombre propio en la historia** (patrón #137): `ronda/integracion-r10-base`, las ramas de la R10 y `ronda/r11-1-agente-perfil`. Decidir si se borran después de integrar.
7. **Patrones de privacidad:**
   - el #64 frena cualquier dirección completa en dominios de portales, aunque sea inventada;
   - el #130, el #131 y el #132 obligan a dejar partidos los ejemplos de `extraction.test.ts`.

   Decidir si se afinan.
8. **Archivos sueltos en los worktrees**, para borrar a mano:
   - `C:/wt/jso-rojo/docs/adr/034-parser-bumeran-por-remitente.md`;
   - los `loading.tsx` de `C:/wt/jso-qa/apps/web/app/(app)/{jobs,inbox}/(lista)/`;
   - `C:/wt/jso-pantallas`, que quedó en detached HEAD con el árbol desordenado por armar la `-v2`.
9. **Al llegar el primer aviso real de Computrabajo:** `COMPUTRABAJO_RECOMMENDED = true` en `portal-guide.ts`.
10. **Texto legal y política de privacidad** antes de pasar `CV_PROFILE_AGENT` a `all`.

## 6. Lo que quedó afuera o pendiente

- **R11-5:** el cómo-se-crea de las alertas de Bumeran, ZonaJobs y Computrabajo (`howTo` en `portal-guide.ts`) es genérico y nadie lo contrastó con la pantalla real de cada portal. Hay que revisarlo antes de la apertura.
- **R11-8:** el PR depende del paso manual 1.
- **P2 de la auditoría:**
  - el 16, el 17 y el 22 no se pudieron reproducir sin correr la app;
  - el 18 (dos totales en el Mercado) pide decidir qué número se muestra;
  - el 24 lo resolvió R11-10, y el 19 y el 21, R11-12 y R11-9/R11-11.
- **Jobicy `management`/`business`** siguen asignando Administración solo por la categoría. La auditoría citó solo WWR.
- **ZonaJobs** no tiene esqueleto ni lector. **Computrabajo de país** (`.com.ar`) no se rutea.
- **Pool de Bumeran:** solo el ADR-036, propuesto.
- **R11-2:** una skill pendiente que dejó de estar en la demanda ya no se limpia sola. Distinguir el origen pediría una columna.
- **R11-12:** escribir el resumen del CV a mano pediría una columna.
- **R11-11:** en celular, con «descartarla», el botón fijo «Postularme» se oculta. Queda «Marcar aplicada».
- **C5 legales:** bloqueada.

## 7. CI

Al cierre de este informe:
- **`carril`:** falla en todos los PR rojos, como corresponde. Los mergea el dueño del proyecto.
- **Unit, integración, build y secrets:** en verde.
- **e2e:** seguían en cola.
- **#506:** necesitó una vuelta de prettier (02006d3).

El estado final de cada PR se ve en GitHub.
