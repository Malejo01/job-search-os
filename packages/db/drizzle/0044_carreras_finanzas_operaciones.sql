-- Custom SQL migration file, put your code below! --
-- Migración de DATOS (ronda C-2b), no de esquema. La escribí a mano con `drizzle-kit generate --custom`.
-- Va DESPUÉS de la 0043, que amplía `waitlist_role_check` con finanzas_contabilidad y asistencia_operaciones.
-- Da de alta 8 skills (mismas filas que seeds/skills.json) y actualiza hr_generalist, que pierde
-- "nómina", "nomina" y "payroll" (pasan a la skill `payroll`).
-- Es idempotente: correrla dos veces da el mismo resultado. Sin backfill: ninguna clave se renombra.
INSERT INTO "skills" ("slug", "name", "category", "aliases", "closure_hours", "description", "is_global") VALUES
  ('general_accounting', 'Contabilidad y conciliaciones', 'dominio', ARRAY['contabilidad', 'conciliaciones', 'general ledger', 'accounts payable', 'accounts receivable', 'month-end close', 'cierre contable', 'gaap', 'ifrs', 'bookkeeping']::text[], 40, 'Contabilidad general: registrar movimientos, conciliar cuentas y hacer el cierre contable de cada mes', true),
  ('financial_reporting', 'Reporting financiero y FP&A', 'dominio', ARRAY['fp&a', 'financial reporting', 'estados financieros', 'financial modeling', 'budgeting', 'presupuesto', 'variance analysis']::text[], 24, 'Reporting financiero y FP&A: armar estados financieros, presupuestos y análisis de desvíos para decidir con números', true),
  ('erp_accounting', 'Software contable (NetSuite, QuickBooks, Xero)', 'dominio', ARRAY['netsuite', 'quickbooks', 'xero', 'sage intacct', 'sap fi', 'sap fico', 'odoo', 'tango gestion']::text[], 16, 'Software contable: sistemas como NetSuite, QuickBooks o Xero donde se cargan facturas, pagos y asientos', true),
  ('tax_compliance', 'Impuestos, auditoría y controles', 'dominio', ARRAY['impuestos', 'tax compliance', 'tax returns', 'declaraciones juradas', 'sales tax', 'internal audit', 'sox compliance', 'controles internos']::text[], 24, 'Impuestos, auditoría y controles: presentar declaraciones, cumplir normas fiscales y revisar que los controles internos funcionen', true),
  ('payroll', 'Liquidación de sueldos (payroll)', 'dominio', ARRAY['payroll', 'nómina', 'nomina', 'liquidación de sueldos', 'payroll processing']::text[], 16, 'Liquidación de sueldos: calcular y pagar salarios, aportes y descuentos de cada período', true),
  ('calendar_inbox', 'Agenda, correo y viajes', 'dominio', ARRAY['calendar management', 'gestión de agenda', 'inbox management', 'travel arrangements', 'coordinación de reuniones']::text[], 6, 'Agenda, correo y viajes: ordenar el calendario y la casilla de otra persona y organizar sus reuniones y viajes', true),
  ('office_suite', 'Google Workspace / Microsoft 365', 'dominio', ARRAY['google workspace', 'g suite', 'google docs', 'google drive', 'gmail', 'microsoft office', 'office 365', 'microsoft 365', 'outlook', 'powerpoint']::text[], 6, 'Google Workspace y Microsoft 365: documentos, correo, calendario y presentaciones de uso diario en una oficina', true),
  ('data_entry', 'Carga de datos (data entry)', 'dominio', ARRAY['data entry', 'carga de datos', 'ingreso de datos', 'data input', 'digitación', 'mecanografía']::text[], 4, 'Carga de datos: pasar información de documentos o formularios a un sistema con rapidez y sin errores', true),
  ('hr_generalist', 'Generalista de RRHH', 'dominio', ARRAY['hr generalist', 'people operations', 'onboarding de empleados', 'employee onboarding', 'legislación laboral', 'legislacion laboral']::text[], 16, 'Generalista de RRHH: ingreso de personal, nómina, legislación laboral y trámites del día a día de las personas de una empresa', true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "category" = EXCLUDED."category",
  "aliases" = EXCLUDED."aliases",
  "closure_hours" = EXCLUDED."closure_hours",
  "description" = EXCLUDED."description";
