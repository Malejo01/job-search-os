# ADR-023: Finanzas y contabilidad, Asistencia virtual y operaciones, y licencias «preferidas»

**Status:** Accepted · **Date:** 2026-10-23 · Amplía ADR-022 (carreras no técnicas y licencias de otro país).

## Context
La tanda 2 de carreras no técnicas (C-2) se midió sobre un snapshot del pool de 1752 ofertas únicas, contando solo remotas de los últimos 30 días y por título:
- **Finanzas y contabilidad:** 27 ofertas. Casi todas en inglés y sin país declarado; 7 con salario.
- **Operaciones y asistencia virtual:** 13 ofertas. Es la de más falsos positivos posibles por título: sales, revenue, marketing, security, it y people operations.
- **Educación online y evaluación de IA:** menos de 5 cada una. Quedan afuera por el umbral de 10 por mes de ADR-022, y porque no hay una fuente que las traiga.

## Decision
1. **Dos carreras nuevas en un grupo nuevo, «Finanzas y operaciones»:**
   - `finanzas_contabilidad`, «Finanzas y contabilidad»;
   - `asistencia_operaciones`, «Asistencia virtual y operaciones».

   La segunda no usa «VA», que en EE. UU. es Veterans Affairs y además es una sigla en inglés dentro de una URL en español. Empieza por «Asistencia virtual» para que el evaluador no la lea como DevOps. `IT_ROLE_KEYS` no cambia.
2. **Separación por título:**
   - `TITLE_TERMS` conservadores: nunca «operations», «assistant», «finance» ni «controller» sueltos.
   - Exclusiones como frases: las operaciones de ventas, revenue, marketing, seguridad, IT, red, plataforma, datos, personas, producto, finanzas y contabilidad, más fraud, trust and safety y engineer/developer/devops. En finanzas, engineer, quant, it, security, sistemas, medical y dental.
   - `project_manager` veta los títulos de operaciones.
3. **`asistencia_operaciones` sale oculta** (`UNLISTED_ROLE_KEYS`) hasta auditar una muestra de títulos:
   - mientras tanto, no aparece en el selector, en los chips de `/mercado` ni en el sitemap;
   - quien la tenga la conserva, y su página responde.
4. **Skills nuevas (8, `dominio`):** `general_accounting`, `financial_reporting`, `erp_accounting`, `tax_compliance`, `payroll`, `calendar_inbox`, `office_suite` y `data_entry`.
   - `payroll` se lleva los alias «payroll» y «nómina» de `hr_generalist`, porque dos skills no pueden compartir término. También entra en `rrhh_it`.
   - Sin «sap», «erp», «audit», «iva», «vat» ni «accounting» sueltos: dan falsos positivos en avisos técnicos.
5. **Licencias (`prefilter/licensing.ts`):**
   - términos nuevos: CPA *licensed*/*required*, *enrolled agent* y «contador público matriculado». «cpa» suelto sigue afuera, porque también es *cost per acquisition*;
   - cuando el texto dice que la licencia es *preferred*, *a plus*, deseable o similar, queda un flag y **no se descarta**. Vale para todos los términos de licencia;
   - el país implícito sale de `locationRaw` y de alias locales (cpce/facpce → AR);
   - como en ADR-022, corre solo con el país cargado, así que el golden no cambia.
6. **Prefiltro:** «administrativ» y «auxiliar contable» dejan de descartar para quien eligió esas carreras (`exemptFor`). Se libera solo «office manager»; *accounting*, *finance* y *operations manager* siguen bloqueados.

## Datos y orden de aplicación
- **0043 (generada):** amplía `waitlist_role_check` con las dos claves.
- **0044 (custom, idempotente):** las 8 skills y `hr_generalist` sin los alias de payroll.
- **Orden:** `db:migrate`, después el merge y el deploy. Las dos migraciones son pura expansión.

## Consequences
- Las primeras 9 ofertas de estas carreras se evalúan con el mismo límite de «disciplina» que la 107: el evaluador no tiene una regla específica de finanzas.
- Para publicar operaciones, Mauro audita 20 títulos con `pool:explain --hints` después de `pool:rehint`, y tienen que quedar 10 o más positivos verdaderos en 30 días. Después, un PR de una línea saca la clave de `UNLISTED_ROLE_KEYS`.
