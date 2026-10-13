-- Migración de DATOS (ronda 43), no de esquema: la generé con `drizzle-kit generate --custom`.
-- A los criterios que tienen las 15 disciplinas de fábrica se les suman las 4 de carreras digitales
-- (marketing_digital, producto, recursos_humanos, customer_success) que falten, al final y sin
-- duplicar. Los criterios con una lista acotada (la persona eligió) no se tocan. Idempotente:
-- correrla de nuevo no cambia nada porque cada valor se agrega solo si todavía no está.
UPDATE "evaluation_criteria"
SET "rules" = jsonb_set(
  "rules",
  '{allowed_disciplines}',
  ("rules"->'allowed_disciplines')
    || CASE WHEN ("rules"->'allowed_disciplines') @> '["marketing_digital"]'::jsonb THEN '[]'::jsonb ELSE '["marketing_digital"]'::jsonb END
    || CASE WHEN ("rules"->'allowed_disciplines') @> '["producto"]'::jsonb THEN '[]'::jsonb ELSE '["producto"]'::jsonb END
    || CASE WHEN ("rules"->'allowed_disciplines') @> '["recursos_humanos"]'::jsonb THEN '[]'::jsonb ELSE '["recursos_humanos"]'::jsonb END
    || CASE WHEN ("rules"->'allowed_disciplines') @> '["customer_success"]'::jsonb THEN '[]'::jsonb ELSE '["customer_success"]'::jsonb END
)
WHERE jsonb_typeof("rules"->'allowed_disciplines') = 'array'
  AND ("rules"->'allowed_disciplines') @> '["ai_engineer","ml_engineer","ai_evaluation","creative_production","fullstack","frontend","backend","devops","data","ciberseguridad","negocio","project_management","administracion_plataformas","arquitectura","otra"]'::jsonb;
