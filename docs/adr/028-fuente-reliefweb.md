# ADR-028: ReliefWeb como fuente del pool para carreras de la beta

**Status:** Proposed · **Date:** 2026-10-30 · Complementa ADR-014, ADR-018, ADR-024 y ADR-027.

## Context
La expansión de la beta cerrada a 6 carreras universitarias y terciarias (ADR-027) incorporó áreas no técnicas:
- `abogacia`: Abogacía y legales
- `administracion_empresas`: Administración de empresas
- `comunicacion`: Comunicación y prensa
- `relaciones_internacionales`: Relaciones internacionales y comex
- Y expandió `finanzas_contabilidad` (impuestos, finanzas, costos, auditoría) y `marketing_digital` (relaciones públicas, prensa, eventos).

Las fuentes tradicionales del pool (Get on Board, Jobicy, Remote OK, Himalayas, We Work Remotely y los ATS públicos de empresas tech) concentran su oferta en ingeniería de software, producto y diseño. Si bien Jobicy y WWR ofrecen categorías como `legal` o `management-and-finance`, el volumen en español y regional para organismos, ONGs y perfiles corporativos e institucionales es reducido.

**ReliefWeb**, operado por la Oficina de Coordinación de Asuntos Humanitarios de las Naciones Unidas (UN OCHA), es el mayor portal global de información humanitaria y desarrollo internacional:
1. Publica miles de vacantes de agencias del sistema de la ONU (ACNUR, UNICEF, PNUD, OIM), organismos multilaterales y organizaciones no gubernamentales internacionales (Oxfam, Médicos Sin Fronteras, Save the Children).
2. Su taxonomía oficial de categorías (`career_categories`) coincide de manera directa con las carreras de la beta:
   - *Administration/Finance* → `administracion_empresas` y `finanzas_contabilidad`.
   - *Advocacy/Communications* → `comunicacion` y `marketing_digital`.
   - *Protection/Human Rights* → `abogacia`.
   - *Logistics/Procurement* y *Operations* → `relaciones_internacionales` (comex/logística) y `administracion_empresas`.
   - *Monitoring & Evaluation* y *Program Management* → `administracion_empresas`.
3. Ofrece presencia en toda América Latina y el Caribe (oficinas y misiones en Colombia, Perú, Ecuador, México, Centroamérica y Cono Sur), avisos multilingües (español e inglés) y posiciones remotas globales (*home-based* o teletrabajo).
4. Dispone de una API v2 REST documentada oficialmente (`https://api.reliefweb.int/v2/jobs`) licenciada bajo CC BY 4.0.

## Decision
1. **Adapter `packages/adapters/src/sources/reliefweb.ts`:**
   - Consume la API v2 pública (`GET https://api.reliefweb.int/v2/jobs`) con parámetros estructurados (`profile=full`, `fields[include][]`).
   - Mapeo puro y determinístico a `RawJob`, sin I/O en la función de transformación (`mapReliefWebJob`).

2. **Apagado por defecto (Kill-switch estricto):**
   - Requiere obligatoriamente el identificador de aplicación (`appname`) en la variable de entorno `RELIEFWEB_APPNAME`.
   - **Comportamiento sin variable:** Si `RELIEFWEB_APPNAME` no está definido o está en blanco, el adapter no realiza llamadas HTTP de red y retorna inmediatamente `{ jobs: [], pagesFetched: 0, seen: 0, skipped: 0 }`. Esto previene llamadas anónimas no autorizadas por UN OCHA.

3. **Mapeo a `RawJob` y reglas de falla cerrado:**
   - `id`: identificador numérico de ReliefWeb (`item.id`).
   - `source.externalId`: `reliefweb:${item.id}` (o `${item.id}`).
   - `source.url`: URL canónica del aviso (`item.fields.url`).
   - `title`: título del puesto (`item.fields.title`).
   - `companyRaw`: primera entidad en `item.fields.source[0].name` (ej. "UNHCR", "UNICEF", "Oxfam").
   - `jdText`: texto descriptivo íntegro (`item.fields.body`).
   - `postedAt`: fecha de creación (`item.fields.date.created`).
   - `categories`: array con los nombres de `item.fields.career_categories`.
   - `tags`: idéntico a categorías para posterior cruce de habilidades.
   - `contractType`: tipo de contrato provisto en `item.fields.job_type.name` (ej. "Staff", "Consultancy", "Internship").

4. **Heurística de modalidad y ubicación (Regla H-1 / PR #300):**
   - Si el título, cuerpo o ubicación indican expresiones como *home-based*, teletrabajo, teleworking o remote:
     - `modality: "remoto"`.
     - Si no se detallan restricciones de residencia específicas en el aviso, `countriesAllowed: null`. De esta forma, el prefiltro señala `location_risk` para que la persona revise los términos, pero no activa el descarte ciego de la regla de país H-1.
   - En caso contrario, si el puesto se asocia a una sede o país específico (`item.fields.country`):
     - `modality: "presencial"`.
     - Se mapea el código ISO3 provisto por ReliefWeb (`COL`, `ARG`, `PER`, etc.) a su equivalente ISO2 (`CO`, `AR`, `PE`) en `countriesAllowed`.

5. **Base de datos e invariantes:**
   - **Sin migraciones inmediatas:** No se modifica el enum PostgreSQL `source_kind` ni la tabla `ats_boards`.
   - En `RawJob.source.kind`, el adapter utiliza `'other'` con `source.name = 'ReliefWeb'` (siguiendo el precedente de `torre.ts`), permitiendo que el pipeline lo procese sin requerir cambios de esquema en base de datos.
   - **Propuesta para Mauro:** Cuando se decida habilitar la ingesta en el pool general con cron periódico, agregar el valor `'reliefweb'` al enum `source_kind` en `packages/db/schema.ts` con su respectiva migración generada con drizzle-kit.

6. **Atribución y términos de servicio:**
   - Cumple estrictamente con la licencia Creative Commons Attribution 4.0 International (CC BY 4.0):
     - Cada aviso mantiene el enlace directo a la oferta original (`source.url`).
     - Se acredita el nombre de la organización publicadora (`companyRaw`).
     - No se sugiere patrocinio, alianza ni aval oficial de Naciones Unidas o UN OCHA.

## Consequences
- **Positivas:** Permite disponer del adapter completamente testeado sobre fixtures sintéticas, listo para activarse una vez registrado el `appname` ante UN OCHA.
- **Riesgo residual:** La proporción de ofertas *home-based* o remotas en ReliefWeb es menor que las ofertas presenciales de terreno. La activación real en producción debe acompañarse de una medición de volumen con `pnpm pool:fetch` para optimizar los filtros por categoría y país.

