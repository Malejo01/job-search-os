-- Custom SQL migration file, put your code below! --
-- Migración de DATOS (ronda 107, ADR-022), no de esquema. La escribí a mano con `drizzle-kit generate --custom`.
-- Va DESPUÉS de la 0036, que amplía `waitlist_role_check` con ventas_b2b y atencion_cliente.
-- Da de alta 5 skills: las mismas filas que seeds/skills.json.
-- Es idempotente: correrla dos veces da el mismo resultado. Sin backfill: ninguna clave se renombra.
INSERT INTO "skills" ("slug", "name", "category", "aliases", "closure_hours", "description", "is_global") VALUES
  ('prospecting', 'Prospección y generación de leads', 'dominio', ARRAY['prospección', 'prospeccion', 'cold calling', 'cold outreach', 'cold email', 'outbound', 'lead generation', 'generación de leads', 'generacion de leads']::text[], 12, 'Prospección: buscar y contactar a empresas o personas que todavía no son clientes para conseguir reuniones de venta', true),
  ('negotiation', 'Negociación y cierre de ventas', 'dominio', ARRAY['negociación', 'negociacion', 'deal closing', 'closing deals', 'cierre de ventas', 'objection handling', 'manejo de objeciones']::text[], 12, 'Negociación y cierre: acordar precio y condiciones con un cliente y responder sus objeciones hasta cerrar la venta', true),
  ('sales_tools', 'Herramientas de ventas (Apollo, Gong)', 'dominio', ARRAY['lemlist', 'gong', 'zoominfo', 'sales navigator', 'linkedin sales navigator', 'outreach.io', 'outreach sequences']::text[], 8, 'Herramientas de ventas: plataformas para buscar contactos, enviar secuencias de mails y analizar llamadas con clientes', true),
  ('chat_support', 'Atención por chat', 'dominio', ARRAY['live chat', 'chat support', 'intercom', 'soporte por chat', 'atención por chat', 'atencion por chat']::text[], 8, 'Atención por chat: responder consultas de clientes en tiempo real por chat, con herramientas como Intercom', true),
  ('hr_generalist', 'Generalista de RRHH', 'dominio', ARRAY['hr generalist', 'people operations', 'onboarding de empleados', 'employee onboarding', 'nómina', 'nomina', 'payroll', 'legislación laboral', 'legislacion laboral']::text[], 16, 'Generalista de RRHH: ingreso de personal, nómina, legislación laboral y trámites del día a día de las personas de una empresa', true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "category" = EXCLUDED."category",
  "aliases" = EXCLUDED."aliases",
  "closure_hours" = EXCLUDED."closure_hours",
  "description" = EXCLUDED."description";
