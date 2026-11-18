# Informe de la tanda R14 «Carreras y CV» (18/11, noche)

Todas las ramas salen de `origin/main` en `0ef91b9`. **Ningún PR se mergeó y ningún PR está abierto todavía:** las ramas están pusheadas y los textos de cada PR quedaron listos. Lo que traba la apertura está en el paso 1 de `docs/beta/informe-r13.md`.

## 1. Ramas, en el orden de merge sugerido

| Orden | Rama | Ticket | Carril | Antes de mergear |
|---|---|---|---|---|
| 1 | `ronda/r14-1-puestos-marketing` | R14-1 · tres puestos de marketing y contenido | rojo | SQL de skills en Neon (§3) |
| 2 | `ronda/r14-4-feedback-admin` | R14-4 · filtro por persona en el feedback del admin | verde | — |
| 3 | `ronda/r14-2-cv-legible-ats` | R14-2 · «¿Tu CV es legible por los filtros (ATS)?» | verde | Después de `ronda/r13-5-detalles-r12` |
| 4 | `ronda/r14-3-personas-carreras` | R14-3 · una persona por carrera (e2e 150) | a mano | **Solo con el job `e2e` en verde** |
| 5 | `ronda/r14-cierre` | Este informe y el Bloque 28 | verde | Al final |

## 2. Qué se probó y qué no

**La mezcla completa no se probó:** el guard del equipo bloquea `git merge`. Las cuatro ramas de la R14 no comparten archivos entre sí.

**Choques previstos con otras tandas:**

- `apps/web/components/profile-agent/read-client.tsx`: lo tocan R13-5 y R14-2. R14-2 agrega dos líneas, un `import` y `<AtsCheck text={text} />`.
- `packages/pipeline/src/index.ts`: lo tocan R14-2, R15-1 y R15-2. Cada una agrega una línea de `export`: hay que conservar todas.
- `docs/BACKLOG.md`: cada cierre agrega un bloque al final. Hay que conservarlos en orden.

**Pruebas por rama:**

- **R14-1:** `pipeline` con 5367 tests, integración de `db` con 457, typecheck, eslint y prettier.
- **R14-2:** 25 tests de la revisión pura, más typecheck y lint.
- **R14-4:** `pipeline`, typecheck, eslint y prettier.
- **Los e2e 111 (caso nuevo), 148 y 150 no se ejecutaron:** el guard bloquea Playwright en local y el job `e2e` solo corre en PRs hacia `main`.

## 3. Pasos manuales para el dueño del proyecto

1. **R14-1, skills en Neon.** Revisar y correr este SQL, sin `db:seed`. Es idempotente. Si el `SELECT` muestra las 5 filas, cerrar con `COMMIT`; si no, con `ROLLBACK`.
   ```sql
   BEGIN;

   INSERT INTO "skills" ("slug", "name", "category", "aliases", "closure_hours", "description", "is_global") VALUES
     ('video_editing_tools', 'Edición de video (Premiere y DaVinci)', 'dominio', ARRAY['adobe premiere', 'premiere', 'adobe premiere pro', 'davinci', 'after effects', 'adobe after effects', 'montaje de video', 'editor de video', 'video editor', 'edición de reels', 'edicion de reels']::text[], 16, 'Edición de video con Premiere o DaVinci: cortar, montar, corregir el color y exportar piezas para redes y publicidad', true),
     ('ugc_content', 'Contenido UGC y creación de contenido', 'dominio', ARRAY['ugc', 'user generated content', 'user-generated content', 'contenido generado por usuarios', 'contenido ugc', 'ugc creator', 'creador ugc', 'creadora ugc', 'content creator', 'creador de contenido', 'creadora de contenido']::text[], 12, 'Contenido UGC: grabar videos y fotos con estilo de usuario real para que las marcas los usen en redes y anuncios', true),
     ('short_video_scripting', 'Guion para reels y video corto', 'dominio', ARRAY['guion para reels', 'guión para reels', 'guiones para reels', 'guion de video', 'guión de video', 'video scripting', 'tiktok reels', 'short form video', 'short-form video', 'youtube shorts']::text[], 8, 'Guion para video corto: pensar el gancho, el ritmo y el cierre de un reel o TikTok antes de grabarlo', true),
     ('generative_ai_content', 'IA generativa para contenido', 'dominio', ARRAY['contenido con ia', 'ia para contenido', 'ai content', 'ai content creation', 'chatgpt para contenido', 'chatgpt para marketing', 'midjourney', 'dall-e', 'canva magic', 'generación de imágenes con ia', 'generacion de imagenes con ia', 'elevenlabs', 'heygen']::text[], 8, 'IA generativa para contenido: usar ChatGPT, Midjourney y similares para armar textos, imágenes y videos de marketing', true),
     ('social_analytics', 'Métricas de redes sociales', 'dominio', ARRAY['métricas de redes', 'metricas de redes', 'métricas de redes sociales', 'metricas de redes sociales', 'social media analytics', 'social analytics', 'creator studio', 'tiktok analytics', 'insights de instagram', 'instagram insights', 'engagement rate', 'tasa de engagement', 'metricool', 'hootsuite', 'reportes de redes', 'kpis de redes']::text[], 12, 'Métricas de redes: leer alcance, interacciones y retención de cada publicación y armar reportes para ajustar el contenido', true)
   ON CONFLICT ("slug") DO NOTHING;

   SELECT slug, name, category, closure_hours, is_global, cardinality(aliases) AS aliases
     FROM "skills"
    WHERE slug IN ('video_editing_tools', 'ugc_content', 'short_video_scripting', 'generative_ai_content', 'social_analytics')
    ORDER BY slug;
   ```
2. **R14-1, `pnpm db:migrate`.** No hay migración nueva, pero vuelve a aplicar `rls/0012`, que suma los tres puestos a los cupos de fundador.
3. **R14-1, `pnpm pool:rehint`**, para reetiquetar los avisos que ya están en el pool.
4. **R14-2, elegir la frase final.** Hoy dice «¿Tu CV es legible por los filtros (ATS)?», con un aviso de que no garantiza nada.

## 4. Qué quedó abierto

- **R14-3 no cubre los tres puestos nuevos.** Cubre las 8 carreras de la beta. Los puestos de R14-1 se suman cuando las dos ramas estén en `main`: es una entrada más en `CARRERAS` y `FAMILY_OF_ROLE` del spec 150.
- **R14-1:** el rótulo de `creacion_contenido` es «Creación de contenido (UGC y redes)», porque el esquema limita el rótulo a 40 caracteres. Los puestos nuevos no se ofrecen en `/acceso`: ampliar esa lista pide una migración.
- **R14-1:** un aviso de marketing que dice solo «ChatGPT» o «IA generativa» no suma la skill `generative_ai_content`. Es a propósito: esos términos también aparecen en avisos de programación y consultoría.
- **R14-2:** trabaja sobre el texto extraído, no sobre el archivo. No puede afirmar que el CV tenga columnas: solo ve si el texto salió desordenado.
- **R14-2:** no se agregó ninguna métrica, porque no existe un patrón de evento sin texto.
- **R14-4:** los estados siguen siendo nuevo, visto y resuelto. Sumar «descartado» pide una migración.

## 5. Gasto de evals

USD 0. Ninguna rama toca `packages/prompts/**` ni `evals/**`.
