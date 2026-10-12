# ADR-014: Pool global de ofertas públicas

**Status:** Accepted · **Date:** 2026-10-12 · **Reemplaza:** la decisión de `docs/SCHEMA.md` "`jobs.userId` y no un catálogo global de ofertas"

## Context
Hasta hoy cada usuario trae sus propias ofertas: el cron de Get on Board y las fuentes extra
corren una vez por persona y guardan una copia completa en `jobs`. Con pocos usuarios alcanza.
Con más, el costo crece en lo que no hace falta: la misma oferta pública se descarga N veces,
respeta mal los límites de cada fuente (varias piden pocas consultas por día) y se guarda N veces.

Además, el producto quiere mostrar mercado por rol (qué piden las ofertas para "backend" o
"QA") y eso necesita mirar las ofertas una sola vez, sin depender de lo que cada persona recibió.

## Decision
1. **Pool global `public_jobs`, sin `user_id`.** Guarda ofertas, no datos de personas. Nada por
   persona (estado, flags, prefiltro, evaluaciones, postulación) va ahí: eso sigue en `jobs`.
   `jobs.public_job_id` (`ON DELETE SET NULL`) liga la copia por usuario con la oferta del pool.
   La asignación del pool a cada usuario es otro paso (JS-138), no esta decisión.
2. **Descarga única por fuente.** Un solo proceso descarga cada fuente respetando su intervalo y
   deja una bitácora global (`public_job_fetches`) con un código de error cerrado, nunca texto del
   proveedor. Los términos y la atribución de cada fuente están en `docs/sources/`.
3. **Dedup dentro del pool sin fusión.** Mismo `(source_kind, external_id)` es la misma fila.
   Misma URL canónica, mismo hash del JD o texto casi igual (similitud ≥ 0.9) de la misma empresa
   dentro de 14 días es una copia: se inserta igual con `dedup_of_id` apuntando a la raíz. Ningún
   texto se pierde (lección del incidente de ADR-013). Empresa más título parecido no marca nada:
   en el pool nadie revisa duplicados posibles. La ventana de 14 días rige también para URL y
   hash; lo que se escape lo cubre el dedup por usuario.
4. **RLS de solo lectura.** `public_jobs`, `public_job_skills` y `role_market_snapshots`: `ENABLE`
   sin `FORCE` y una policy `SELECT` con `using (true)`, como `companies`. Sin policies de
   escritura: escribe el servicio con la conexión dueña. `public_job_fetches`: `ENABLE` sin
   ninguna policy. Se prueba con el rol de la app en `pool-rls.integration.test.ts`.
5. **Retención de 30 días desde la última vez que la fuente devolvió la oferta**
   (`last_seen_at`). Se borra la fila, sus skills (cascada) y su crudo. Las copias por usuario no
   cambian. Antes de guardar se quitan emails y teléfonos (`stripContacts`) de título, empresa, ubicación, JD y crudo: el evaluador no
   los necesita y no hay motivo para conservarlos (ley 25.326).
6. **`role_hints`** (roles de la lista cerrada que el aviso parece servir) se calcula al insertar
   con una función pura, sin LLM: categoría de la fuente más listas cortas sobre el título. Vacío
   significa que no se sabe, no que no sirva.
7. **Migración 0018** suma el pool, tres valores al enum `source_kind` y dos columnas en
   `profiles` (`target_role`, `pool_daily_eval_limit`). La aplica Mauro con `pnpm db:migrate`
   antes del merge.

## Consequences
- Una descarga por fuente en vez de una por usuario: menos consultas, y los límites de cada
  fuente se respetan en un solo lugar.
- El mercado por rol se calcula sobre el pool (`role_market_snapshots`), no sobre lo que cada
  persona vio.
- Hay una tabla más grande y global. La retención de 30 días la acota, y sin `user_id` no puede
  filtrar datos entre personas: lo que se lee es información pública de las fuentes.
- Los contactos se quitan de título, empresa, ubicación, JD y crudo antes de guardar. En el crudo
  se limpia valor por valor sobre el JSON parseado (las URLs y los números no se tocan); si el
  cuerpo no es JSON, se limpia como texto. El pool no conserva emails ni teléfonos.
- Solo se guardan avisos con URL http/https: otra cosa (`javascript:`, `data:`) se salta.
- Una copia que reaparece pasada la ventana de 14 días entra como fila nueva sin marca. Es un
  error visible y barato; no pierde datos.
- Las fuentes con atribución obligatoria (por ejemplo Jobicy) exigen mostrar el link tal como lo
  da la fuente: por eso `source_url` se guarda sin quitarle parámetros y `canonical_url` aparte.
- Queda pendiente (JS-138): asignar ofertas del pool a cada persona según su rol objetivo,
  con un tope diario de evaluaciones.
