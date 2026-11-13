-- Custom SQL migration file, put your code below! --
-- Migración de DATOS (R6-5), no de esquema. Da de alta 4 skills de relaciones públicas (las mismas filas
-- que seeds/skills.json). Idempotente: correrla dos veces da el mismo resultado. Sin backfill. No toca
-- user_skills ni role_skills (ese mapa vive en el seed y en el código).
INSERT INTO "skills" ("slug", "name", "category", "aliases", "closure_hours", "description", "is_global") VALUES
  ('crisis_management', 'Manejo de crisis y reputación', 'dominio', ARRAY['manejo de crisis', 'gestión de crisis', 'gestion de crisis', 'crisis management', 'comité de crisis', 'comite de crisis', 'plan de crisis', 'reputation management', 'gestión de reputación', 'gestion de reputacion']::text[], 32, 'Manejo de crisis: anticipar riesgos, armar el plan y el comité y proteger la reputación de una marca u organización', true),
  ('event_management', 'Organización de eventos', 'dominio', ARRAY['organización de eventos', 'organizacion de eventos', 'event management', 'event planning', 'event production', 'producción de eventos', 'produccion de eventos', 'eventos corporativos', 'corporate events', 'logística de eventos', 'logistica de eventos']::text[], 24, 'Eventos: planificar presupuesto, proveedores y logística de lanzamientos, congresos y actos corporativos', true),
  ('protocol_etiquette', 'Protocolo y ceremonial de eventos', 'dominio', ARRAY['protocolo empresarial', 'protocolo institucional', 'protocolo de eventos', 'etiqueta protocolar', 'ceremonial de eventos', 'organización de ceremonias', 'organizacion de ceremonias', 'precedencias', 'protocolo corporativo']::text[], 16, 'Protocolo: ubicar invitados, ordenar precedencias y conducir ceremonias y actos institucionales con la etiqueta correcta', true),
  ('influencer_relations', 'Relación con influencers y embajadores', 'dominio', ARRAY['influencer marketing', 'influencers', 'relación con influencers', 'relacion con influencers', 'brand ambassadors', 'embajadores de marca', 'gestión de influencers', 'gestion de influencers', 'influencer relations']::text[], 16, 'Influencers: elegir creadores, acordar condiciones y seguir campañas con embajadores de marca', true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "category" = EXCLUDED."category",
  "aliases" = EXCLUDED."aliases",
  "closure_hours" = EXCLUDED."closure_hours",
  "description" = EXCLUDED."description";
