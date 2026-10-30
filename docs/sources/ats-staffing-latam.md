# Relevamiento de Boards ATS: Staffing y Empresas LATAM

Este documento compila el relevamiento y verificación con `--dry-run` de boards ATS públicos (**Lever**, **Greenhouse**, **Ashby**) para agencias de staffing / nearshore y empresas con contratación activa en **América Latina** (Argentina, Colombia, México, etc.) enfocados en carreras de **contabilidad y finanzas**, **administración y operaciones**, **marketing digital** y **legales**.

> **IMPORTANTE:** Ningún registro se insertó en Neon. Los boards se presentan listos para que Mauro los revise y ejecute con `enabled = false`.

---

## 1. Boards requeridos

| Proveedor | Token | Empresa | Vistos | Remotos | Avisos y roles útiles |
|---|---|---|---|---|---|
| `lever` | `bluecoding` | Blue Coding | 2 | 2 | Staffing nearshore LATAM (`soporte_it=1, frontend=1`). |
| `lever` | `Allata` | Allata | 13 | 6 | Consultora tech con hub en Argentina (`soporte_it=1, frontend=2, fullstack=2, backend=1`). *Nota: token con 'A' mayúscula.* |
| `lever` | `coderio` | Coderio | 21 | 12 | Nearshore staffing para LATAM. Puesto contable/financiero: **`finanzas_contabilidad=1`** (`data_engineer=3, ai_engineer=5, soporte_it=1`, etc.). |
| `lever` | `doola` | doola | 7 | 6 | Formación de empresas, impuestos y contabilidad en EE. UU./LATAM. Puestos clave: **`finanzas_contabilidad=1`** (Tax Reviewer / CPA), **`ventas_b2b=1`**, **`atencion_cliente=1`**, **`ux_ui=1`**. |

---

## 2. Boards adicionales seleccionados (Contabilidad, Administración, Marketing, Legales)

| Proveedor | Token | Empresa | Vistos | Remotos | Avisos y roles útiles |
|---|---|---|---|---|---|
| `lever` | `RyzLabs` | RYZ Labs | 51 | 41 | Startup studio / staffing con base en Argentina y EE. UU. Roles remotos LATAM: **`finanzas_contabilidad=3`** (National Large Loss Project Accountant, AR & Billing), **`project_manager=3`**, **`asistencia_operaciones=1`**, **`marketing_digital=1`**, **`ventas_b2b=2`**. |
| `greenhouse` | `cookunity` | CookUnity | 159 | 30 | Empresa fundada en Argentina con contratación masiva en LATAM: **`finanzas_contabilidad=1`**, **`marketing_digital=3`**, **`asistencia_operaciones=2`**, **`product_manager=6`**, **`rrhh_it=1`**, **`data_analyst=3`**. |
| `greenhouse` | `cloudbeds` | Cloudbeds | 30 | 9 | Hospitality software con equipo de operaciones/finanzas en LATAM: **`finanzas_contabilidad=1`** (Accounting Specialist - LATAM), **`customer_success=1`**, **`atencion_cliente=1`**, **`project_manager=1`**. |
| `greenhouse` | `clara` | Clara | 155 | 7 | Fintech corporativa y de spend management para LATAM (México, Brasil, Colombia, Argentina): **`marketing_digital=2`**, **`ventas_b2b=1`**. |
| `greenhouse` | `powerdigitalmarketing` | Power Digital | 264 | 200 | Agencia global de marketing y crecimiento con contratación en Argentina/LATAM: **`marketing_digital=14`**, **`project_manager=18`**, **`customer_success=8`**, **`rrhh_it=5`**, **`ventas_b2b=2`**. |
| `greenhouse` | `xometry` | Xometry | 237 | 10 | Plataforma de manufactura bajo demanda con contratación en Buenos Aires/LATAM: **`marketing_digital=3`**, **`ventas_b2b=1`**, **`customer_success=1`**, **`project_manager=1`**. |
| `greenhouse` | `backblaze` | Backblaze | 34 | 33 | Cloud storage con contratación abierta en LATAM. Incluye rol directivo legal específico: **`Sr. Director of Commercial and Legal Affairs (LATAM)`**. |
| `ashby` | `latamcent` | LatamCent | 10 | 5 | Consultora de nearshore staffing y executive search para LATAM: **`ventas_b2b=2`**, **`soporte_it=1`**. |
| `lever` | `jobandtalent` | Jobandtalent | 39 | 11 | Plataforma internacional de workforce y staffing: **`finanzas_contabilidad=1`**, **`ventas_b2b=5`**, **`soporte_it=1`**. |
| `lever` | `toptal` | Toptal | 28 | 28 | Red global de talento remoto y staffing: **`ventas_b2b=9`**, **`rrhh_it=2`**, **`customer_success=2`**. |

---

## 3. SQL para Mauro (`enabled = false`)

Ejecutar en la base correspondiente cuando se decida habilitarlos:

```sql
-- Boards ATS de Staffing y empresas para LATAM (Ticket G-4)
-- Cargados con enabled = false para revisión previa de Mauro.
INSERT INTO ats_boards (provider, token, company_name, enabled, notes)
VALUES
  -- 1. Requeridos
  ('lever', 'bluecoding', 'Blue Coding', false, 'Staffing nearshore IT para LATAM'),
  ('lever', 'Allata', 'Allata', false, 'Consultora tech con contratación activa en Argentina'),
  ('lever', 'coderio', 'Coderio', false, 'Nearshore staffing LATAM con puestos de finanzas/contabilidad'),
  ('lever', 'doola', 'doola', false, 'Formación y contabilidad en EE.UU./LATAM; roles de finanzas y ventas'),

  -- 2. Adicionales de Staffing, Finanzas, Operaciones, Marketing y Legales
  ('lever', 'RyzLabs', 'RYZ Labs', false, 'Startup studio / staffing en Argentina y LATAM con contabilidad y operaciones'),
  ('greenhouse', 'cookunity', 'CookUnity', false, 'Contratación remota LATAM con puestos de finanzas, marketing y operaciones'),
  ('greenhouse', 'cloudbeds', 'Cloudbeds', false, 'Software hotelero con contabilidad y soporte para LATAM'),
  ('greenhouse', 'clara', 'Clara', false, 'Fintech de gestión de gastos corporativos en LATAM (marketing y ventas)'),
  ('greenhouse', 'powerdigitalmarketing', 'Power Digital', false, 'Agencia de growth marketing con roles remotos para Argentina/LATAM'),
  ('greenhouse', 'xometry', 'Xometry', false, 'Marketplace B2B con contratación de marketing y cuentas en Buenos Aires'),
  ('greenhouse', 'backblaze', 'Backblaze', false, 'Infraestructura cloud con puesto de legales LATAM (Sr. Director Legal Affairs)'),
  ('ashby', 'latamcent', 'LatamCent', false, 'Headhunting y nearshore staffing en LATAM'),
  ('lever', 'jobandtalent', 'Jobandtalent', false, 'Workforce y staffing marketplace con puestos de finanzas y ventas'),
  ('lever', 'toptal', 'Toptal', false, 'Staffing global remoto con roles de ventas B2B y recruitment')
ON CONFLICT (provider, token) DO NOTHING;
```

