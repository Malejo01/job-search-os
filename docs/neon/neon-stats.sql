-- neon-stats.sql — foto de solo lectura para medir el ahorro de Neon (ronda C6-3, 2/11/2026).
--
-- Cómo usarlo (Mauro): Neon › proyecto › SQL Editor › base `jobsearch` (la de producción). Corré cada
-- bloque por separado y guardá la salida. Hacelo dos veces: ANTES de mergear el PR de C6-3 y unos
-- días DESPUÉS (con la misma actividad: una tanda de asignaciones del pool). Solo hay SELECT y un
-- EXPLAIN: no escribe nada y no reinicia las estadísticas (no llama a pg_stat_statements_reset()).
--
-- Ojo con las estadísticas: en Neon `pg_stat_statements` se reinicia cada vez que el compute se
-- suspende. Los totales sirven solo desde ese reinicio (bloque 1). Para comparar antes y después
-- mirá los promedios por llamada (`filas_por_llamada`, `kb_por_llamada`), no los totales.

-- 1. ¿Desde cuándo cuentan las estadísticas?
select stats_reset from pg_stat_statements_info;

-- 2. Las 15 consultas que más leen. `kb_leidos_por_llamada` = bloques leídos de disco (shared_blks_read);
--    `kb_tocados_por_llamada` = leídos + encontrados en caché (shared_blks_hit). Un bloque son 8 KB.
select
  left(regexp_replace(query, '\s+', ' ', 'g'), 160)                     as consulta,
  calls,
  round(rows::numeric / nullif(calls, 0), 1)                            as filas_por_llamada,
  round(shared_blks_read * 8.0 / nullif(calls, 0))                      as kb_leidos_por_llamada,
  round((shared_blks_hit + shared_blks_read) * 8.0 / nullif(calls, 0))  as kb_tocados_por_llamada,
  round((total_exec_time / nullif(calls, 0))::numeric, 1)               as ms_por_llamada
from pg_stat_statements
order by shared_blks_read desc
limit 15;

-- 3. La selección de candidatas del pool sobre public_jobs (C6-3, punto 1).
--    ANTES: una fila con `jd_shingles` en la lista de columnas, ~300 filas y ~70 KB por fila.
--    DESPUÉS: esa fila ya no aparece y se ve la consulta acotada (sin `jd_shingles` ni `raw_ref`) más una
--    lectura por tandas de hasta 25 ids con la fila completa, solo de las elegidas.
select
  left(regexp_replace(query, '\s+', ' ', 'g'), 200)                     as consulta,
  (query ilike '%"jd_shingles"%')                                       as trae_shingles,
  calls,
  round(rows::numeric / nullif(calls, 0), 1)                            as filas_por_llamada,
  round(shared_blks_read * 8.0 / nullif(calls, 0))                      as kb_leidos_por_llamada,
  round((shared_blks_hit + shared_blks_read) * 8.0 / nullif(calls, 0))  as kb_tocados_por_llamada
from pg_stat_statements
where query ilike '%from "public_jobs"%'
  and query not ilike '%count(%'
order by (shared_blks_hit + shared_blks_read) desc
limit 10;

-- 4. El conteo de la cola por persona sobre job_queue (C6-3, punto 2).
--    ANTES: recorre todos los `evaluate_job` de la cola (incluidos los terminados) y los cruza con `jobs`.
--    DESPUÉS (con la migración 0056 aplicada): entra por las ofertas de la persona y el índice `job_queue_job_id`.
select
  left(regexp_replace(query, '\s+', ' ', 'g'), 200)                     as consulta,
  calls,
  round(shared_blks_read * 8.0 / nullif(calls, 0))                      as kb_leidos_por_llamada,
  round((shared_blks_hit + shared_blks_read) * 8.0 / nullif(calls, 0))  as kb_tocados_por_llamada,
  round((total_exec_time / nullif(calls, 0))::numeric, 1)               as ms_por_llamada
from pg_stat_statements
where query ilike '%job_queue%'
  and query ilike '%payload%'
order by (shared_blks_hit + shared_blks_read) desc
limit 10;

-- 5. Tamaño de las tablas implicadas y de la cola. Si `job_queue` crece mes a mes, el índice de la 0056 es
--    lo que evita que el conteo crezca con ella.
select
  relname                                         as tabla,
  n_live_tup                                      as filas_vivas,
  pg_size_pretty(pg_table_size(relid))            as tabla_con_toast,
  pg_size_pretty(pg_indexes_size(relid))          as indices
from pg_stat_user_tables
where relname in ('public_jobs', 'job_queue', 'jobs')
order by pg_table_size(relid) desc;

-- 6. Qué columnas pesan en public_jobs (promedio por fila según el último ANALYZE; sin leer la tabla).
--    Esperable: `jd_shingles` y `jd_text` arriba de todo. Son las que la selección ya no trae de las 300 candidatas.
select attname as columna, avg_width as bytes_promedio
from pg_stats
where schemaname = 'public' and tablename = 'public_jobs'
order by avg_width desc
limit 8;

-- 7. Solo DESPUÉS de aplicar la 0056: el índice existe y se usa.
select indexname, indexdef
from pg_indexes
where tablename = 'job_queue';

select indexrelname as indice, idx_scan as veces_usado
from pg_stat_user_indexes
where relname = 'job_queue';

-- 8. El plan del conteo de la cola para UNA persona (EXPLAIN ANALYZE de un SELECT: solo lee).
--    Reemplazá <USER_ID> por un users.id real (por ejemplo el tuyo: select id from users where email = '…').
--    DESPUÉS tiene que verse `Index Scan using job_queue_job_id on job_queue` dentro de un Nested Loop, y no un
--    `Seq Scan on job_queue` ni un Hash Join que recorre toda la cola. Mirá «Buffers: shared hit/read».
explain (analyze, buffers)
select count(*)::int
from job_queue q
join jobs on jobs.id::text = q.payload->>'jobId'
where q.queue = 'evaluate_job'
  and jobs.user_id = '<USER_ID>'
  and jobs.public_job_id is not null
  and q.created_at >= now() - interval '24 hours';
