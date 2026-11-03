# ADR-022: Ventas B2B y Atención al cliente, RRHH ampliado y licencias de otro país

**Status:** Accepted · **Date:** 2026-10-21 · Reemplaza el punto 3 de ADR-020 en lo que toca a `sales`.

## Context
La H2 del roadmap suma carreras no técnicas. Con un snapshot del pool de 1752 ofertas únicas, la medición dio:
- **Ventas B2B:** unas 150 ofertas por título (SDR, BDR, Account Executive, Business Development), casi todas sin carrera y todas en inglés.
- **Atención al cliente:** entre 12 y 19 ofertas, contando la categoría `customer-support` de Get on Board.
- **RRHH:** 27 ofertas. `rrhh_it` ya las tomaba por los tags de la fuente y solo le faltaban términos de título (hr generalist, people operations).
- **Contenido, redes y diseño gráfico/video:** 9 ofertas, de las cuales 6 ya caían en `marketing_digital`.
- **Licencia profesional de otro país:** 9 avisos con la regla estricta (licensed attorney, registered nurse, certified public accountant, matrícula profesional…).

## Decision
1. **Dos carreras nuevas en un grupo nuevo «Ventas y atención»:** `ventas_b2b` («Ventas B2B (SDR, AE)») y `atencion_cliente` («Atención al cliente»). El rótulo de ventas nombra el oficio para que el evaluador lo vea en `{{target_role}}`. `IT_ROLE_KEYS` no cambia: quien no eligió puesto sigue recibiendo solo IT (ADR-015, punto 4).
2. **Separación por título, no por prefiltro:**
   - `TITLE_EXCLUSIONS` y `VETO_TERMS` separan ventas de `solutions_engineer` («Sales Engineer» es solutions) y de `customer_success`. «Account manager» suelto no entra en ninguna carrera: «key account» es ventas y «technical account manager» es CS.
   - Atención deja en `soporte_it` lo técnico (technical, it, engineer, software, developer).
   - El prefiltro solo deja de descartar «vendedor/a», «atención al cliente» y «call center» para quien eligió esa carrera (`exemptFor` en `NON_IT_TITLE`).
3. **`rrhh_it` conserva la clave** y cambia el rótulo a «RRHH y recruiting», con los términos que faltaban. Renombrar costaba alias, redirect y backfill, como en ADR-019, por una clave que solo se ve en la URL. Queda como deuda cosmética.
4. **Contenido, redes y diseño gráfico/video no es carrera:** son términos de `marketing_digital`, y `capcut` entra a sus skills en lugar de `hubspot`. Con menos de 10 ofertas no se ofrece un mercado vacío.
5. **Get on Board suma `sales`** (→ `ventas_b2b`). **`customer-support` da las dos carreras posibles** (`atencion_cliente` y `customer_success`) en Get on Board, Jobicy, Remote OK y WWR, y `titleFit` separa por título.
6. **Regla nueva del prefiltro: licencia o matrícula profesional de otro país** (`prefilter/licensing.ts`). Usa un conjunto estricto de frases, sin `cpa` ni `licensed` sueltos, sin `colegiatura` y sin la licencia de conducir («driver's license», «must be licensed to drive»). Sí entra `colegiado/a`, porque en varios países de la región es la habilitación para ejercer.
   - Corre solo si la persona cargó su país, igual que la residencia, así que el golden y los evals no cambian. Si el país es desconocido, no corre: falla abierta.
   - Si el texto nombra el país de la persona cerca de la frase, la licencia es de su país: pasa con un flag.
   - Si no, descarta con la razón `licencia_profesional`.
7. **Publicación:** se publican las dos carreras. `UNLISTED_ROLE_KEYS` y `selectableRoleGroups(keep)` quedan como mecanismo para ocultar del selector una carrera con menos de 10 ofertas, sin quitársela a quien ya la tiene. **Actualización (C6-4):** en las páginas públicas, las carreras de la beta aparecen solas al llegar a las 10 ofertas, con dos listas de override en código (ver ADR-029).

## Datos y orden de aplicación
- **0036 (generada):** amplía el check de `waitlist` con las dos claves.
- **0037 (custom, idempotente):** da de alta 5 skills: `prospecting`, `negotiation`, `sales_tools`, `chat_support` y `hr_generalist`.
- Sin backfill: ninguna clave se renombra.
- **Orden:** `pnpm db:migrate` → merge → deploy. Si se aplica después del deploy, en el medio `/acceso` con «Ventas B2B» falla el check.
- **Después:** `pnpm pool:rehint --remote`, primero sin `--apply` y después con `--apply`, y reinicio de la bitácora de Get on Board para el backfill de `sales`.

## Consequences
- **El evaluador no tiene disciplina para ventas ni atención** (límite de ADR-015). El modelo puede bajar el score de un aviso de ventas a «otra disciplina» aunque sea la carrera elegida. El código no lo puede deshacer sin cambiar el prompt, lo que pide evals y gasto. El ajuste informativo para medirlo (`discipline_unmapped`) queda para una ronda posterior, porque esta no toca `decide.ts`.
- **Ventas tiene 0 ofertas en español** hasta que `sales` de Get on Board haga el backfill.
- **Atención es frágil:** con los hints de categoría da unas 69 ofertas, pero `titleFit` separa. Si después del `pool:rehint` queda por debajo de 10, se la oculta con `UNLISTED_ROLE_KEYS`.
- **«Business development»** a veces es partnerships, no ventas. Se acepta.
