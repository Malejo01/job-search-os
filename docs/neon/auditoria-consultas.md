# Auditoría de Consumo de Neon (PostgreSQL Serverless)
**Fecha:** 31 de octubre de 2026  
**Autor:** Agente G4 (AfinIAJobs)  
**Insumo para:** Ronda de Ahorro y Optimización de Neon del 3/11/2026  
**Alcance:** Solo lectura y análisis estático de consultas, transferencia de red (egress) y patrones de cómputo en `apps/web` y `packages/adapters`. No se modifica código en este documento.

---

## 1. Resumen Ejecutivo

Neon factura en función de:
1. **Compute Units (CU-hours):** tiempo que el endpoint de cómputo está activo. Neon tiene *auto-suspend* configurable (típicamente tras 5 minutos de inactividad a 0 CU). Si un proceso o monitor consulta la base cada 1 o 2 minutos, el endpoint no se suspende jamás, facturando 720 horas de cómputo al mes.
2. **Transferencia de datos (Data Egress):** volumen de bytes transferidos desde Postgres hacia Vercel / workers.
3. **Escaneos de almacenamiento (Storage I/O y Active Working Set):** consultas sin índices adecuados o que ordenan en memoria obligan a levantar páginas del disco a RAM.

El análisis de código identificó **8 focos principales de desperdicio** de transferencia y tiempo de cómputo. Las mayores oportunidades de ahorro provienen de:
1. **Empujar agregaciones a SQL en vitrinas públicas y mercado** (en vez de transferir miles de filas o textos de avisos completos a Node.js para resumirlos en memoria).
2. **Precomputar y persistir candidatos de skills en `/market` (JS-102)** para evitar la lectura y tokenización de 300 textos de avisos (`jd_text`) por visita.
3. **Cachear catálogos estáticos en el worker de evaluación** (evitando el N+1 de descargar la taxonomía de `skills` 50 veces por lote).
4. **Introducir caché / desacoplamiento en `/api/cron/status`** para no impedir la suspensión automática de cómputo de Neon por polling de monitores externos.

---

## 2. Tabla Consolidada de Consultas Auditadas

| Prioridad / Ahorro | Área / Función | Archivo y Líneas | Filas devueltas (por llamada) | KB devueltos (por llamada) | Llamadas estimadas / día | KB devueltos / día | Causa principal |
|---|---|---|---|---|---|---|---|
| **1 (Crítica)** | Mercado por carrera: texto de avisos para detectar inglés (`readCareerMarketInput`) | [`packages/adapters/src/market/career-market.ts#L29-L47`](file:///c:/Programacion/Job%20Search%202026/job-search-os-v1/job-search-os/packages/adapters/src/market/career-market.ts#L29-L47) | 200 – 1.000 | 2.000 – 10.000 KB (2–10 MB) | 72 | **140 – 720 MB** | `left(jd_text, 30000)` transferido para miles de avisos solo para chequear idioma |
| **2 (Crítica)** | Vitrina pública sin agregación SQL (`readPoolShowcaseInput`) | [`packages/adapters/src/market/showcase.ts#L37-L48`](file:///c:/Programacion/Job%20Search%202026/job-search-os-v1/job-search-os/packages/adapters/src/market/showcase.ts#L37-L48) | 2.000 – 5.000 | 600 – 1.500 KB (0.6–1.5 MB) | 48 | **28 – 72 MB** | `select` sin `LIMIT` de ofertas de 7 días; agregación en Node.js |
| **3 (Alta)** | Candidatos de skills de `/market` (JS-102) (`computeCandidates`) | [`apps/web/lib/market.ts#L47-L75`](file:///c:/Programacion/Job%20Search%202026/job-search-os-v1/job-search-os/apps/web/lib/market.ts#L47-L75) | 300 + 110 (skills) | 900 – 1.500 KB (0.9–1.5 MB) | 30 – 60 | **27 – 90 MB** | Lee 300 `jd_text` completos; falta índice `(user_id, created_at)` en `jobs` |
| **4 (Alta)** | N+1 de catálogo de taxonomía en Worker (`loadChecklistSkills`) | [`packages/adapters/src/worker/evaluate-job.ts#L145-L165`](file:///c:/Programacion/Job%20Search%202026/job-search-os-v1/job-search-os/packages/adapters/src/worker/evaluate-job.ts#L145-L165) | 110 filas × 50 | 150 KB × 50 = 7.500 KB por lote | 4 – 6 lotes (200 jobs) | **30 – 45 MB** | Descarga la tabla `skills` con aliases JSONB por cada job evaluado en el lote |
| **5 (Alta)** | Polling frecuente de Monitor de Estado y compute despierto (`readStatusSnapshot`) | [`packages/adapters/src/worker/status.ts#L196-L265`](file:///c:/Programacion/Job%20Search%202026/job-search-os-v1/job-search-os/packages/adapters/src/worker/status.ts#L196-L265) / [`apps/web/app/api/cron/status/route.ts#L22-L55`](file:///c:/Programacion/Job%20Search%202026/job-search-os-v1/job-search-os/apps/web/app/api/cron/status/route.ts#L22-L55) | ~40 filas (en 5 queries analíticas) | ~15 KB | 1.440 (ping cada 1 min) | **21 MB + Impide auto-suspend de Neon** | `force-dynamic`, `no-store`, 5 queries analíticas complejas por minuto |
| **6 (Media)** | JSONB de decisión completo en «Tu encaje» (`readOwnData`) | [`apps/web/lib/fit.ts#L53-L65`](file:///c:/Programacion/Job%20Search%202026/job-search-os-v1/job-search-os/apps/web/lib/fit.ts#L53-L65) | Hasta 600 | 900 – 1.800 KB (0.9–1.8 MB) | 20 – 40 | **18 – 72 MB** | Trae `decision` (JSONB pesado con justificaciones y reasoning) cuando solo usa `checklist` |
| **7 (Media)** | Carga de shingles para duplicados en ingesta (`loadRecentJobs`) | [`packages/adapters/src/ingest/ingest-job.ts#L118-L153`](file:///c:/Programacion/Job%20Search%202026/job-search-os-v1/job-search-os/packages/adapters/src/ingest/ingest-job.ts#L118-L153) | 100 – 300 | 300 – 900 KB | 50 – 100 | **15 – 90 MB** | Trae arrays `jd_shingles` (5-gramas) de todos los jobs de 14 días en cada job entrante |
| **8 (Media)** | `select()` sin proyección de columnas en perfil, ofertas y contexto | [`packages/adapters/src/applicant/context.ts#L86, L109`](file:///c:/Programacion/Job%20Search%202026/job-search-os-v1/job-search-os/packages/adapters/src/applicant/context.ts#L86) / [`apps/web/lib/job-detail.ts#L207`](file:///c:/Programacion/Job%20Search%202026/job-search-os-v1/job-search-os/apps/web/lib/job-detail.ts#L207) / [`evaluate-job.ts#L349`](file:///c:/Programacion/Job%20Search%202026/job-search-os-v1/job-search-os/packages/adapters/src/worker/evaluate-job.ts#L349) | 1 por llamada | 10 – 30 KB | 200 – 500 | **5 – 15 MB** | `select()` trae columnas no usadas: `rawResumeText`, `cvSourceRaw`, `jd_shingles` |

---

## 3. Detalle de Consultas y Propuestas Concretas (Ordenadas por Ahorro Estimado)

### Propuesta 1. Mercado por carrera: eliminar `left(jd_text, 30000)` de `readCareerMarketInput`
- **Ubicación:** [`packages/adapters/src/market/career-market.ts` líneas 29-47](file:///c:/Programacion/Job%20Search%202026/job-search-os-v1/job-search-os/packages/adapters/src/market/career-market.ts#L29-L47).
- **Problema:** Para armar las estadísticas de mercado de una carrera en los últimos 30 días, la consulta trae `sql<string | null>left(${s.publicJobs.jdText}, 30000)` para cada oferta. En `packages/pipeline/src/pool/career/career-market.ts` (líneas 132-135), este texto solo se usa para ejecutar `detectEnglish(job.jdText, job.lang)` y `detectJobLanguage(job.jdText, job.lang)`.
- **Consumo:** Un rol con 500 avisos transfiere ~5 a 10 MB en una sola llamada. Con 6 carreras revalidando cada 30 min (unstable_cache de 1800 s), genera más de **300 a 700 MB/día** de egress innecesario.
- **Propuesta concreta:**
  1. Durante la ingesta de `public_jobs` (en `packages/adapters/src/pool/upsert.ts`), precomputar y persistir dos banderas booleanas o enum en `public_jobs`: `english_required` y confirmar `lang` (que ya existe).
  2. Eliminar completamente `jdText` de `readCareerMarketInput`.
  3. Como solución inmediata sin migración: si no se puede agregar columna todavía, leer únicamente los primeros 800 caracteres (`left(jd_text, 800)`), suficientes para detección de idioma, reduciendo el payload en un **97%**.
- **Ahorro estimado:** **~500 MB/día** (baja a < 15 MB/día).

---

### Propuesta 2. Vitrina pública: agregar en SQL en vez de volcar el pool a memoria
- **Ubicación:** [`packages/adapters/src/market/showcase.ts` líneas 37-48](file:///c:/Programacion/Job%20Search%202026/job-search-os-v1/job-search-os/packages/adapters/src/market/showcase.ts#L37-L48) y consumo en [`apps/web/lib/showcase.ts` línea 58](file:///c:/Programacion/Job%20Search%202026/job-search-os-v1/job-search-os/apps/web/lib/showcase.ts#L58).
- **Problema:** `readPoolShowcaseInput` realiza un `select` con 7 columnas sobre todas las ofertas activas en 7 días (`where lastSeenAt >= now - 7 days and dedupOfId is null and sourceKind in (...)`) **sin cláusula `limit`**. Luego `buildPoolShowcase` en el pipeline cuenta cuántas son remotas, cuántas de Argentina, y agrupa empresas con `filter` y bucles en memoria en Node.js.
- **Consumo:** En una base con 3.000 a 6.000 ofertas públicas activas, cada revalidación de ISR transfiere entre 1 y 2 MB de filas crudas. Con revalidaciones periódicas de `/`, `/mercado` y `/ofertas`, suma entre **30 y 70 MB/día**.
- **Propuesta concreta:**
  1. Reemplazar la lectura de miles de filas por una consulta SQL agregada que calcule los totales directamente en Postgres:
     ```sql
     select
       count(*)::int as total,
       count(*) filter (where modality = 'remoto')::int as remoto,
       count(*) filter (where modality = 'hibrido')::int as hibrido,
       count(*) filter (where modality = 'presencial')::int as presencial,
       count(*) filter (where 'AR' = any(countries_allowed) or location_raw ilike '%argentina%')::int as argentina,
       count(*) filter (where first_seen_at >= now() - interval '24 hours')::int as new_24h
     from public_jobs
     where dedup_of_id is null
       and last_seen_at >= now() - interval '7 days'
       and source_kind = any($1);
     ```
  2. Para el top 10 de empresas (`SHOWCASE_TOP_COMPANIES`), hacer un `GROUP BY company_raw HAVING count(*) >= 5 ORDER BY count(*) DESC LIMIT 10`.
  3. La respuesta pasa de 5.000 objetos a 1 fila agregada + 10 filas de empresas (< 2 KB).
- **Ahorro estimado:** **~50 MB/día** (> 99% de reducción en esa consulta) y menor consumo de CPU en el servidor web.

---

### Propuesta 3. JS-102: Cachear y persistir candidatos a skill de `/market`
- **Ubicación:** [`apps/web/lib/market.ts` líneas 47-75](file:///c:/Programacion/Job%20Search%202026/job-search-os-v1/job-search-os/apps/web/lib/market.ts#L47-L75) (`computeCandidates`).
- **Problema:** En cada cálculo, `computeCandidates` descarga los textos completos de hasta 300 avisos (`select jdText, companyRaw, ... from jobs order by createdAt desc limit 300`) más todas las filas de `skills`.
  - **Falta de índice:** La tabla `jobs` tiene el índice `jobs_user_first_seen` sobre `(user_id, first_seen_at desc)`, pero **no tiene ningún índice sobre `(user_id, created_at desc)`**. Al ordenar por `createdAt desc`, Postgres debe realizar un escaneo y ordenamiento en memoria para cada usuario.
  - **Payload:** 300 descripciones de puesto con un promedio de 4 KB representan ~1.2 a 1.5 MB transferidos por llamada.
  - Aunque está envuelto en `unstable_cache` (1 hora por usuario), cualquier reinicio de servidor o invalidación manual (alta de oferta, pegado de JD) obliga a transferir 1.5 MB y ordenar en memoria.
- **Propuesta concreta (insumo de la issue #241 y backlog JS-102):**
  1. **Persistencia de candidatos precalculados:** Crear la tabla `market_candidates` con RLS:
     ```sql
     create table market_candidates (
       user_id uuid not null references users(id) on delete cascade,
       term text not null,
       count integer not null,
       updated_at timestamptz not null default now(),
       primary key (user_id, term)
     );
     alter table market_candidates enable row level security;
     ```
  2. **Cálculo asíncrono:** Calcular los candidatos únicamente durante el snapshot semanal de mercado o en segundo plano en el worker tras procesar un lote de ofertas, escribiendo las 15 filas finales en `market_candidates`.
  3. **Lectura directa en `/market`:** `/market` ejecuta `select term, count from market_candidates where user_id = ... order by count desc limit 15`, transfiriendo solo **15 filas (~1 KB)** y eliminando el 100% de la lectura de `jd_text`.
  4. **Corrección de índice:** Si temporalmente se mantiene el cálculo sobre `jobs`, cambiar el orden a `firstSeenAt desc` (que ya aprovecha el índice `jobs_user_first_seen`) o proponer la migración del índice compuesto `index("jobs_user_created").on(t.userId, t.createdAt.desc())`.
- **Ahorro estimado:** **~30 a 80 MB/día** y eliminación del sorting scan en Postgres.

---

### Propuesta 4. Worker de Evaluación: eliminar N+1 en la carga de la taxonomía de Skills
- **Ubicación:** [`packages/adapters/src/worker/evaluate-job.ts` líneas 145-165 y 378](file:///c:/Programacion/Job%20Search%202026/job-search-os-v1/job-search-os/packages/adapters/src/worker/evaluate-job.ts#L145-L165).
- **Problema:** El worker toma lotes de hasta 50 ofertas (`EVALUATE_LIMIT = 50`) de `job_queue`. Por cada oferta individual en el bucle, llama a `loadChecklistSkills(db, job.userId)`.
  - La primera consulta de `loadChecklistSkills` es:
    `db.select({ slug: s.skills.slug, name: s.skills.name, aliases: s.skills.aliases }).from(s.skills)`
  - La tabla `skills` es un catálogo casi estático (más de 110 filas con arrays JSONB de aliases, ~150 KB de transferencia).
  - En un solo lote de 50 ofertas, **la tabla completa de skills se transfiere 50 veces**, consumiendo `50 × 150 KB = 7.5 MB` de ancho de banda y 50 roundtrips de red contra Neon.
- **Propuesta concreta:**
  1. Mantener la taxonomía de `skills` en una variable en memoria (módulo singleton o mapa en el contexto del worker con un TTL de 1 hora o carga al iniciar el lote).
  2. `loadChecklistSkills` recibe el catálogo pre-cargado o consulta la caché en memoria. Solo debe consultar a la base lo específico del usuario: `skillLevels` y `userSkills` (que son muy livianos, < 3 KB).
- **Ahorro estimado:** De 7.5 MB a 150 KB por corrida de worker (**~30 a 45 MB/día**, reduciendo 200 a 300 consultas N+1 diarias).

---

### Propuesta 5. Monitor de Estado: desacoplar polling para permitir auto-suspend de Neon
- **Ubicación:** [`apps/web/app/api/cron/status/route.ts` líneas 22-55](file:///c:/Programacion/Job%20Search%202026/job-search-os-v1/job-search-os/apps/web/app/api/cron/status/route.ts#L22-L55) y [`packages/adapters/src/worker/status.ts` líneas 196-265](file:///c:/Programacion/Job%20Search%202026/job-search-os-v1/job-search-os/packages/adapters/src/worker/status.ts#L196-L265).
- **Problema:**
  - `GET /api/cron/status` tiene configurado `force-dynamic` y `Cache-Control: no-store`.
  - Cada vez que se invoca, abre una conexión y ejecuta 5 consultas SQL analíticas pesadas:
    1. `select max(last_seen_at) from public_jobs`
    2. Agregaciones de conteo y tiempos en `job_queue`
    3. Conteo de llamadas de LLM de las últimas 24 h en `llm_calls` cruzado con `model_routing`
    4. `select max(created_at) from evaluations`
    5. Ventana particionada con `row_number() over (partition by source_kind order by started_at desc)` sobre `public_job_fetches` de 7 días.
  - Si un monitor externo (Better Uptime, UptimeRobot, Checkly o cron de Vercel) consulta cada 1 o 2 minutos, ejecuta **7.200 consultas analíticas por día**.
  - **Impacto Severo en Facturación:** Neon Serverless duerme el cómputo (0 CU) tras 5 minutos de inactividad. Consultar la base cada 60 segundos mantiene el cómputo encendido **24 horas al día, 30 días al mes (720 h)**, impidiendo el beneficio económico central de Neon.
- **Propuesta concreta:**
  1. Configurar encabezados de caché en la respuesta HTTP: `Cache-Control: public, s-maxage=60, stale-while-revalidate=120`. Si el monitor externo consulta cada 30 o 60 segundos, la respuesta la sirve la CDN/Edge de Vercel sin tocar Postgres ni despertar Neon.
  2. Alternativa recomendada: que la ruta `/api/cron/status` guarde el resultado en un registro en caché o que el worker de mantenimiento escriba el snapshot cada 10-15 minutos.
- **Ahorro estimado:** Permite que Neon suspenda su cómputo durante períodos de baja actividad (madrugadas y fines de semana), ahorrando potencialmente entre **200 y 400 horas de cómputo (CU-hours) al mes**.

---

### Propuesta 6. «Tu encaje» (/fit): proyectar sub-objeto en vez del JSONB completo de decisión
- **Ubicación:** [`apps/web/lib/fit.ts` líneas 53-65](file:///c:/Programacion/Job%20Search%202026/job-search-os-v1/job-search-os/apps/web/lib/fit.ts#L53-L65) (`readOwnData`).
- **Problema:** Trae hasta 600 filas de evaluaciones (`limit(600)`) con `jobId` y la columna `decision` completa (`jsonb`).
  - La columna `decision` contiene todo el resultado del LLM: `score`, `accion_sugerida`, razonamientos extensos, arrays de riesgos y ajustes.
  - En [`apps/web/lib/fit.ts` línea 119](file:///c:/Programacion/Job%20Search%202026/job-search-os-v1/job-search-os/apps/web/lib/fit.ts#L119), `/fit` **únicamente usa `parseChecklist(decision)`** (el campo `decision.checklist`).
  - Cada `decision` pesa entre 2 y 4 KB. En 600 evaluaciones, son ~1.5 a 2.4 MB transferidos por visita a la pestaña de encaje.
- **Propuesta concreta:**
  - Extraer en SQL únicamente el campo requerido usando el operador de Postgres `->`:
    ```ts
    const evals = await tx
      .select({
        jobId: s.evaluations.jobId,
        checklist: sql<unknown>`${s.evaluations.decision}->'checklist'`,
      })
      .from(s.evaluations)
      ...
    ```
  - Esto reduce el tamaño de cada fila en un 80%, bajando la transferencia de 1.8 MB a ~300 KB por visita.
- **Ahorro estimado:** **~20 a 50 MB/día**.

---

### Propuesta 7. Detección de duplicados en ingesta: evitar cargar shingles de 14 días
- **Ubicación:** [`packages/adapters/src/ingest/ingest-job.ts` líneas 118-153](file:///c:/Programacion/Job%20Search%202026/job-search-os-v1/job-search-os/packages/adapters/src/ingest/ingest-job.ts#L118-L153) (`loadRecentJobs`).
- **Problema:** Cada vez que entra un aviso nuevo a la bandeja o por webhook, `loadRecentJobs` busca ofertas recientes del usuario (ventana de 14 días) y trae la columna `jdShingles` (array de miles de 5-gramas para el cálculo de Jaccard).
  - Si el usuario tiene 200 ofertas en 14 días, transfiere ~600 KB a 1 MB de arrays JSONB.
  - Además, inmediatamente después (líneas 155-160) hace otra consulta a `jobSources` para traer los IDs externos.
- **Propuesta concreta:**
  1. Cortocircuito de duplicados exactos: si el aviso entrante coincide por `canonical_url` o por `(source_kind, external_id)`, se marca inmediatamente como duplicado sin necesidad de traer los shingles de los últimos 14 días.
  2. Si requiere comparación por similitud de texto, filtrar primero por empresa similar o título normalizado antes de traer `jd_shingles`.
- **Ahorro estimado:** **~20 a 40 MB/día** en momentos de ingesta activa.

---

### Propuesta 8. Proyección estricta de columnas en `select()`
- **Ubicaciones:**
  - [`packages/adapters/src/applicant/context.ts` líneas 86 y 109](file:///c:/Programacion/Job%20Search%202026/job-search-os-v1/job-search-os/packages/adapters/src/applicant/context.ts#L86): `select().from(s.profiles)` y `select().from(s.applicationSettings)`.
  - [`packages/adapters/src/worker/evaluate-job.ts` líneas 349 y 363](file:///c:/Programacion/Job%20Search%202026/job-search-os-v1/job-search-os/packages/adapters/src/worker/evaluate-job.ts#L349): `select().from(s.jobs)` y `select().from(s.profiles)`.
  - [`apps/web/lib/job-detail.ts` línea 207](file:///c:/Programacion/Job%20Search%202026/job-search-os-v1/job-search-os/apps/web/lib/job-detail.ts#L207): `select().from(s.jobs)`.
- **Problema:** El uso de `select()` ciego sin especificar campos transfiere columnas pesadas que nunca se consumen en ese contexto. En `profiles` transfiere el CV extraído crudo (`rawResumeText`), y en `jobs` transfiere `jdShingles`.
- **Propuesta concreta:** Reemplazar los `select()` por proyecciones explícitas con las propiedades estrictamente declaradas en los tipos de retorno correspondientes (`EvaluationJob`, `CandidateProfile`, `JobDetail`).
- **Ahorro estimado:** **~5 a 15 MB/día**.

---

## 4. Plan de Acción Recomendado para la Ronda del 3/11

1. **Paso 1 (Sin migraciones, código puro en adapters y web):**
   - **Showcase Vitrina:** Mover la agregación de `readPoolShowcaseInput` a SQL con `COUNT(*)` y `GROUP BY`.
   - **Worker N+1:** Implementar caché en memoria para la taxonomía `skills` en `evaluate-job.ts`.
   - **Career Market:** Reducir o eliminar `left(jd_text, 30000)` en `readCareerMarketInput`.
   - **Endpoint de Estado:** Agregar `s-maxage=60, stale-while-revalidate=120` en `/api/cron/status`.
   - **Tu encaje (/fit):** Extraer solo `${s.evaluations.decision}->'checklist'`.

2. **Paso 2 (Con migraciones planificadas):**
   - **JS-102 (/market):** Crear la tabla `market_candidates` con RLS y el índice `(user_id, created_at desc)` en `jobs`, desacoplando completamente `/market` del texto de las ofertas.
   - **Detección de idioma en pool:** Agregar columnas `english_level` y `lang_confirmed` en `public_jobs` para suprimir permanentemente el texto de los avisos en las estadísticas de mercado.

