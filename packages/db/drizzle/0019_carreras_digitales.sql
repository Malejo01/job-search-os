-- Migración de DATOS (ronda 40), no de esquema: la escribí a mano con `drizzle-kit generate --custom`.
-- Da de alta las 19 skills de las carreras digitales (mismas filas que seeds/skills.json) y
-- ajusta los aliases de `salesforce` (`hubspot` pasa a ser skill propia) y de `seo` (`ga4` también).
-- Idempotente: correrla dos veces da lo mismo. Sin ALTER TYPE: solo categorías que ya existen.
INSERT INTO "skills" ("slug", "name", "category", "aliases", "closure_hours", "is_global") VALUES
  ('google_ads', 'Google Ads (SEM)', 'dominio', ARRAY['adwords', 'google adwords', 'search engine marketing', 'search ads', 'performance max']::text[], 16, true),
  ('meta_ads', 'Meta Ads', 'dominio', ARRAY['facebook ads', 'instagram ads', 'meta ads manager', 'meta business suite', 'facebook business manager']::text[], 16, true),
  ('ga4', 'Google Analytics (GA4)', 'datos', ARRAY['google analytics', 'google analytics 4', 'universal analytics']::text[], 12, true),
  ('email_marketing', 'Email marketing', 'dominio', ARRAY['mailchimp', 'klaviyo', 'newsletter', 'newsletters', 'email automation', 'marketing automation', 'campañas de email']::text[], 12, true),
  ('copywriting', 'Copywriting', 'dominio', ARRAY['copywriter', 'redacción publicitaria', 'redaccion publicitaria', 'content writing', 'redacción de contenidos', 'redaccion de contenidos']::text[], 16, true),
  ('social_media', 'Redes sociales (social media)', 'dominio', ARRAY['social media', 'community management', 'community manager', 'instagram', 'tiktok', 'redes sociales']::text[], 12, true),
  ('product_management', 'Product management', 'dominio', ARRAY['product manager', 'product owner', 'gestión de producto', 'gestion de producto', 'gestión de productos', 'gestion de productos']::text[], 24, true),
  ('scrum_agile', 'Scrum / Agile', 'dominio', ARRAY['scrum', 'agile', 'kanban', 'sprint planning', 'scrum master', 'metodologías ágiles', 'metodologias agiles']::text[], 16, true),
  ('jira', 'Jira', 'dominio', ARRAY['jira software', 'atlassian', 'confluence']::text[], 8, true),
  ('roadmap', 'Roadmap de producto', 'dominio', ARRAY['product roadmap', 'roadmapping', 'hoja de ruta', 'priorización de producto', 'priorizacion de producto']::text[], 12, true),
  ('product_discovery', 'Product discovery', 'dominio', ARRAY['continuous discovery', 'descubrimiento de producto', 'jobs to be done', 'jtbd']::text[], 16, true),
  ('sourcing', 'Sourcing de talento', 'dominio', ARRAY['talent sourcing', 'boolean search', 'búsqueda booleana', 'busqueda booleana', 'headhunting']::text[], 12, true),
  ('interviewing', 'Entrevistas', 'dominio', ARRAY['entrevistas por competencias', 'entrevistas técnicas', 'entrevistas tecnicas', 'behavioral interviews', 'technical screening']::text[], 12, true),
  ('ats', 'ATS (seguimiento de candidatos)', 'dominio', ARRAY['applicant tracking system', 'sistema de seguimiento de candidatos', 'greenhouse', 'workable', 'teamtailor']::text[], 8, true),
  ('employer_branding', 'Employer branding', 'dominio', ARRAY['marca empleadora', 'employer brand', 'candidate experience']::text[], 16, true),
  ('linkedin_recruiter', 'LinkedIn Recruiter', 'dominio', ARRAY['linkedin talent solutions', 'linkedin talent', 'linkedin sourcing']::text[], 8, true),
  ('hubspot', 'HubSpot', 'dominio', ARRAY['hubspot crm', 'hubspot marketing', 'hubspot sales']::text[], 12, true),
  ('customer_onboarding', 'Onboarding de clientes', 'dominio', ARRAY['customer onboarding', 'client onboarding', 'implementación de clientes', 'implementacion de clientes']::text[], 12, true),
  ('churn_retention', 'Churn y retención', 'dominio', ARRAY['churn', 'retención de clientes', 'retencion de clientes', 'customer retention', 'net promoter score', 'renovaciones']::text[], 16, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "category" = EXCLUDED."category",
  "aliases" = EXCLUDED."aliases",
  "closure_hours" = EXCLUDED."closure_hours";
--> statement-breakpoint
UPDATE "skills" SET "aliases" = ARRAY['apollo', 'crm']::text[] WHERE "slug" = 'salesforce';
--> statement-breakpoint
UPDATE "skills" SET "aliases" = ARRAY['core web vitals', 'lighthouse', 'json-ld', 'hreflang', 'gtm']::text[] WHERE "slug" = 'seo';
