-- Migración de DATOS (ronda 45, ADR-016), no de esquema: la generé con `drizzle-kit generate --custom`.
-- Copia el puesto único de cada perfil a la lista nueva: target_roles = ARRAY[target_role] donde
-- target_role no es null y la lista todavía está vacía. Idempotente: correrla de nuevo no cambia nada
-- (la condición `= '{}'` deja de cumplirse) y no pisa lo que la persona ya eligió. Sin puesto, queda '{}'.
UPDATE "profiles"
SET "target_roles" = ARRAY["target_role"]::text[]
WHERE "target_role" IS NOT NULL
  AND "target_roles" = '{}'::text[];
