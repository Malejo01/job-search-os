# Informe de la tanda R17 «Rediseño, Interview y Academy» (22/11)

Rediseño de la navegación y de la marca, más información en la oferta (detalle del puntaje, condiciones laborales, transparencia y «Preparar mi postulación»), diagnóstico del CV por ítems, dictado por voz, el simulador de entrevistas, Academy y la base de la mascota. Todo con el modelo simulado: ningún agente llamó a un modelo real ni mergeó nada.

Base: `origin/main` en 360cc92. **Es independiente de la tanda S4**: las dos se integran por separado.

## Cómo están armadas las ramas

Una sola cadena: cada rama apunta al último commit de su ticket y contiene a las anteriores. Se integran en este orden, o alcanza con la última (`ronda/r17-cierre`).

| # | Rama | Qué hace |
|---|---|---|
| 1 | `ronda/r17-01-menu` | Menú Hoy · Match · CV · Tracker · Interview; Academy, Perfil y Ajustes en «Más»; rutas nuevas fuera de robots |
| 2 | `ronda/r17-07-diagnostico-cv` | Diagnóstico del CV por ítems (estructura, legibilidad y secciones por código; palabras clave y logros en «Pronto») |
| 3 | `ronda/r17-02-bajada-asistente` | Bajada «Tu asistente de empleabilidad inteligente» y prompt del asistente v1.1 sin fecha fija |
| 4 | `ronda/r17-03-sello-detalle` | El sello abre el puntaje por criterio; textos pendientes de aprobación en un solo archivo |
| 5 | `ronda/r17-09-dictar` | Dictado por voz del navegador en el chat del CV |
| 6 | `ronda/r17-04-condiciones` | Condiciones laborales de la oferta |
| 7 | `ronda/r17-10-academy` | Academy: fichas en Markdown con estado, 16 en borrador, revisión para admins y testers |
| 8 | `ronda/r17-05-transparencia` | Transparencia del aviso (también trae la base de Interview: tablas, RLS, adaptador, prompts y ruteo) |
| 9 | `ronda/r17-06-preparar-postulacion` | Preparar mi postulación, de solo lectura, hasta «Ir al aviso» |
| 10 | `ronda/r17-11-ayudas-contextuales` | Ayudas «?» junto a los términos del CV y de la oferta |
| 11 | `ronda/r17-12-mascota-base` | Mascota con marcador neutro hasta tener las imágenes |
| 12 | `ronda/r17-08-interview` | Pantalla del simulador de entrevistas y rutas privadas en el middleware |
| 13 | `ronda/r17-cierre` | Academy sin prerender, backlog, este informe y los pasos manuales |

**A tener en cuenta al integrar:**
- Las ramas 7 a 12 no compilan solas (`next build` intenta prerenderizar Academy): el arreglo está en la 13. Con la cadena completa el build queda en verde.
- **Con la S4:** chocan `packages/db/seeds/model_routing.json`, `docs/BACKLOG.md` (bloques 33 y 34) y la numeración de migraciones (la de Interview figura como 0073, igual que la de la S4: hay que regenerarla con el próximo número, snapshot y journal incluidos). Quizás también el asistente.
- Dos specs e2e comparten el prefijo 153 (`153-preparar-postulacion` y `153-interview`).

## Migraciones y SQL
- Tablas `interview_sessions` e `interview_answers` con RLS 0045 y 0046 (cada una con su `GRANT`) y borrado en cascada.
- Dos filas nuevas de `model_routing` (`interview_questions` en Haiku, `interview_feedback` en Sonnet, respaldo Gemini) con SQL con guardas en `pasos-manuales-r17.md`.
- Sin variables nuevas.

## Rendimiento
- Las páginas públicas siguen estáticas. Ninguna ruta tocada sube más de 2 kB de First Load: `/hoy` sube 2 kB por el saludo de la mascota (en el límite) y `/jobs/[id]` 0,3 kB. Middleware y First Load compartido sin cambios.
- Las pantallas existentes no suman consultas en el render.

## Verificación
- Typecheck y lint en verde. Unitarios en verde, salvo tres tests de enlaces simbólicos del escaneo de privacidad (Windows) y cuatro de `evals` que dependen del golden privado local.
- Integración con Postgres local de las tablas, políticas, topes y reservas de Interview, y del SQL de ruteo.
- **Sin correr:** e2e (la base local no tenía usuarios de prueba), capturas y axe (el puerto de la app local estaba ocupado por otra aplicación). Quedan para el CI y para la revisión manual.

## Lo que espera aprobación
Los textos de `apps/web/lib/textos-rediseno.ts`, las 16 fichas de Academy (en borrador) y la mascota (imágenes y nombre). Detalle en `pasos-manuales-r17.md`.
