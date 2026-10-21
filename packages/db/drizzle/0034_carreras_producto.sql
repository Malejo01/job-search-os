-- Migración de DATOS (ronda 97, ADR-019), no de esquema: la escribí a mano con `drizzle-kit generate --custom`.
-- `producto_proyectos` se partió en cuatro carreras: product_manager, product_owner, project_manager y
-- product_marketing. Va DESPUÉS de la 0033 (expande el check de `waitlist` con las claves nuevas).
-- 1) Da de alta 7 skills (mismas filas que seeds/skills.json) y saca `gtm` de los aliases de `growth_marketing`.
-- 2) `jobs.matched_role`, `profiles.target_roles` / `target_role` y `waitlist.role`: de la clave vieja a la nueva.
--    La carrera nueva sale del titular del perfil (product owner y marketing antes que proyectos, así
--    "Product Owner / Scrum Master" queda en product_owner); sin titular o sin pista, product_manager.
--    La lista de espera no tiene titular: todas pasan a product_manager.
-- Idempotente: correrla dos veces da lo mismo. La clave vieja sigue permitida en el check de `waitlist`
-- hasta la contracción (otra ronda, con los conteos en 0).
INSERT INTO "skills" ("slug", "name", "category", "aliases", "closure_hours", "description", "is_global") VALUES
  ('go_to_market', 'Go-to-market y lanzamientos', 'dominio', ARRAY['go-to-market', 'go to market', 'gtm', 'product launch', 'product launches', 'lanzamiento de producto', 'lanzamientos']::text[], 16, 'Go-to-market: planificar cómo se presenta un producto al mercado y qué hacer el día del lanzamiento', true),
  ('positioning_messaging', 'Posicionamiento y mensajes', 'dominio', ARRAY['product positioning', 'market positioning', 'brand messaging', 'product messaging', 'value proposition', 'propuesta de valor', 'buyer persona', 'sales enablement']::text[], 12, 'Posicionamiento y mensajes: definir qué decir de un producto, a quién y por qué es mejor que otras opciones', true),
  ('market_research', 'Investigación de mercado y competencia', 'dominio', ARRAY['market research', 'competitive analysis', 'competitor analysis', 'análisis competitivo', 'analisis competitivo', 'investigación de mercado', 'investigacion de mercado']::text[], 12, 'Investigación de mercado: estudiar clientes y competidores para decidir qué producto o mensaje conviene', true),
  ('user_stories', 'Historias de usuario y backlog', 'dominio', ARRAY['user stories', 'historias de usuario', 'product backlog', 'backlog grooming', 'backlog refinement', 'refinamiento', 'acceptance criteria', 'criterios de aceptación', 'criterios de aceptacion']::text[], 8, 'Historias de usuario y backlog: escribir qué necesita la persona usuaria y ordenar el trabajo pendiente del equipo', true),
  ('project_planning', 'Planificación de proyectos', 'dominio', ARRAY['project planning', 'planificación de proyectos', 'planificacion de proyectos', 'gantt', 'ms project', 'microsoft project', 'cronograma', 'wbs']::text[], 16, 'Planificación de proyectos: armar el plan con tareas, plazos y responsables, y seguir su avance', true),
  ('risk_management', 'Riesgos, alcance y presupuesto', 'dominio', ARRAY['risk management', 'gestión de riesgos', 'gestion de riesgos', 'scope management', 'gestión del alcance', 'gestion del alcance', 'project budget', 'presupuesto del proyecto']::text[], 16, 'Riesgos, alcance y presupuesto: anticipar qué puede salir mal en un proyecto y cuidar lo acordado y lo gastado', true),
  ('pm_certifications', 'Certificaciones (PMP, PSM, CSPO)', 'dominio', ARRAY['pmp', 'capm', 'prince2', 'psm', 'pspo', 'cspo', 'csm', 'safe agilist']::text[], 40, 'Certificaciones de gestión de proyectos y producto, como PMP, PSM o CSPO, que se rinden con examen', true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "category" = EXCLUDED."category",
  "aliases" = EXCLUDED."aliases",
  "closure_hours" = EXCLUDED."closure_hours",
  "description" = EXCLUDED."description";
--> statement-breakpoint
UPDATE "skills" SET "aliases" = ARRAY['paid media', 'cro', 'lifecycle', 'funnels', 'revops', 'growth', 'marketing']::text[] WHERE "slug" = 'growth_marketing';
--> statement-breakpoint
UPDATE "jobs" AS j
SET "matched_role" = CASE
    WHEN p."headline" ~* 'product\s+owner|due[ñn][oa]\s+de\s+producto' THEN 'product_owner'
    WHEN p."headline" ~* 'product\s+marketing|marketing\s+de\s+producto' THEN 'product_marketing'
    WHEN p."headline" ~* 'project\s+manager|program\s+manager|scrum|agile\s+coach|\mpmo\M|proyectos' THEN 'project_manager'
    ELSE 'product_manager'
  END
FROM "profiles" AS p
WHERE p."user_id" = j."user_id"
  AND j."matched_role" = 'producto_proyectos';
--> statement-breakpoint
UPDATE "jobs" SET "matched_role" = 'product_manager' WHERE "matched_role" = 'producto_proyectos';
--> statement-breakpoint
WITH m AS (
  SELECT "user_id",
    CASE
      WHEN "headline" ~* 'product\s+owner|due[ñn][oa]\s+de\s+producto' THEN 'product_owner'
      WHEN "headline" ~* 'product\s+marketing|marketing\s+de\s+producto' THEN 'product_marketing'
      WHEN "headline" ~* 'project\s+manager|program\s+manager|scrum|agile\s+coach|\mpmo\M|proyectos' THEN 'project_manager'
      ELSE 'product_manager'
    END AS nuevo
  FROM "profiles"
  WHERE 'producto_proyectos' = ANY("target_roles")
)
UPDATE "profiles" AS p
SET "target_roles" = CASE
      WHEN m.nuevo = ANY(p."target_roles") THEN array_remove(p."target_roles", 'producto_proyectos')
      ELSE array_replace(p."target_roles", 'producto_proyectos', m.nuevo)
    END
FROM m
WHERE p."user_id" = m."user_id";
--> statement-breakpoint
-- El principal es siempre el primero de la lista (ADR-016)
UPDATE "profiles"
SET "target_role" = COALESCE("target_roles"[1], 'product_manager')
WHERE "target_role" = 'producto_proyectos';
--> statement-breakpoint
UPDATE "waitlist" SET "role" = 'product_manager' WHERE "role" = 'producto_proyectos';
