# ADR-048: Ficha del aviso compartida, con clave por hash del texto

**Status:** Proposed · **Date:** 2026-11-26 · **Relacionada:** ADR-001, ADR-002, ADR-014, ADR-042

## Context
- La pantalla de detalle necesita, para cada aviso, un resumen en español, las tareas, lo que pide (con nivel indispensable o deseable), las 7 condiciones y las habilidades ligadas al puesto. Hoy eso no está estructurado: cada pantalla lo infiere por su cuenta.
- Esa información sale **solo del texto del aviso**. Dos personas que ven el mismo aviso necesitan la misma ficha, y pagar el modelo dos veces por el mismo texto es gasto sin valor.
- Hay avisos que no están en el pool (alertas por email, avisos pegados): la clave no puede ser el id de una oferta del pool.
- El modelo lee texto que viene de afuera. Lo que devuelve es una propuesta, no una decisión (ADR-001).

## Decision
1. **Una ficha por descripción.** Tabla `job_cards` (migración 0087, `rls/0071`), una fila por `jd_hash`, con restricción única. Sirve a todas las personas y a las ofertas fuera del pool.
2. **La clave es el sha256 del texto normalizado** (`jobCardHash`, `packages/pipeline/src/job-card/normalize.ts`): recortado, espacios colapsados y minúsculas. Es la misma normalización de `jobs.jd_hash` y `public_jobs.jd_hash`, así la RLS une la ficha con la oferta sin recalcular nada. El sha256 está escrito en el paquete puro (sin `node:crypto`, que no entra en componentes de cliente) y un test lo compara con `node:crypto`.
3. **Sin `user_id` y sin rastro de quién la pidió.** La ficha es función del texto; guardar quién la generó sería un dato personal sin uso. Por eso la tabla queda fuera de la regla «toda tabla de usuario lleva `user_id`» (ADR-002), con la misma justificación que `public_jobs`.
4. **RLS con `FORCE`.** Lectura de la app: solo si el hash coincide con una oferta de la persona (`jobs`, que ya tiene su RLS) o con un aviso del pool (`public_jobs`). Sin coincidencia, cero filas. La app (`jobsearch_app`) no tiene permiso de escritura: la escribe el proceso que genera la ficha con la conexión de servicio, por policies `TO CURRENT_USER`. Así una persona no puede plantar una ficha falsa que vean las demás.
5. **Estados de la fila:** `lista` (con la ficha), `fallida` (con un código de error corto y el número de intentos, para reintentar) y `sin_texto` (no se llamó al modelo). `card` solo existe con `lista` (CHECK). Los estados `preparando`, `tope` y `apagada` son de la pantalla, no de la base.
6. **Lo que se guarda ya está verificado.** El modelo devuelve cada dato con su cita literal; `verifyJobCard` busca la cita en el texto y descarta lo que no encuentra (falla cerrado). El esquema Zod es estricto: una clave de más hace fallar la ficha entera. Nada se deduce: lo que el aviso no dice queda vacío («No especificado»).
7. **Si el aviso cambia de texto, es otro hash y otra ficha.** La anterior queda como estaba (la usan las ofertas que todavía tienen ese texto). No se migran ni se pisan fichas. Un cambio de prompt o de esquema se reconoce por `prompt_version` y `schema_version`; la regeneración es una decisión aparte.
8. **Todo detrás de `JOB_CARD`** (apagada, `testers` o `all`, mismo patrón que `CV_COACH`). Apagada, no se genera, no se gasta y la app se ve como antes.
9. **Columnas de copia** (`area`, `jd_language`, `english_level`, `modality`) para que `/market` pueda contar después sin abrir el JSON. Esta decisión no cambia `/market`.

10. **Quién genera (S4).** Con `JOB_CARD=testers` el worker de evaluación solo genera la ficha de ofertas de cuentas que `jobCardAllowed` deja pasar (falla cerrado: sin cuenta o sin email, no). Los testers por rol en la base no se miran en el worker: a ellos la ficha se les genera al abrir el detalle.
11. **El resumen también se verifica (S1).** Además de citar texto real, lo que afirma el resumen tiene que salir de sus citas verificadas (mismas cifras y herramientas y, en avisos en español, las palabras); si no, se descarta.
12. **Ofertas anteriores a `jd_hash` (R31).** La RLS une la ficha con la oferta por `jobs.jd_hash`. Al pedir la ficha (detalle o evaluación) se completa el hash de una oferta que lo tiene nulo, con el mismo cálculo de la ingesta (`fillMissingJdHash`), solo para ofertas de la persona. No hace falta un backfill masivo.
13. **Fichas huérfanas (S5).** Las fichas de textos pegados sobreviven a la oferta y a la cuenta. `purgeOrphanJobCards` (`packages/adapters/src/retention/job-cards.ts`) borra las que ya no están en ninguna oferta ni en el pool y tienen más de 24 h; si el aviso se vuelve a pedir, se vuelve a generar.

## Riesgos aceptados
- **Oráculo de existencia por hash (S2).** Quien conoce el texto exacto de un aviso puede saber si existe su ficha. Es inherente a compartirla por hash y no revela nada que esa persona no tenga ya (el texto); la RLS impide leer fichas de textos ajenos.
- **Tope global (S3).** Los topes de fichas (cantidad y USD por día) son de todos, no por persona. Antes de pasar a `JOB_CARD=all` hay que sumar un tope por persona para que una cuenta no agote el cupo de las demás.

## Consecuencias
- Cada aviso se paga una vez, no una por persona.
- Un aviso que cambia una coma se paga de nuevo; es el costo de no depender de un id externo. Se acepta.
- La ficha no tiene dueña: no se borra al borrar una cuenta (no hay nada personal en ella).
- La generación necesita la conexión de servicio en la ruta de «a pedido»; las policies de servicio y el tope diario (R31-03) acotan el daño de un abuso.
