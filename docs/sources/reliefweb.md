# Fuente: ReliefWeb · NO integrada

Ficha técnica de prospección (ticket G-6, 2026-10-30). **Todavía no hay adapter ni código en el repositorio.** No se integra sin la aprobación de Mauro y sin registrar el identificador de aplicación (`appname`) correspondiente. No constituye asesoramiento legal.

---

## 1. Qué ofrece y cobertura

ReliefWeb es el portal líder de información humanitaria y de desarrollo global, operado por la Oficina de Coordinación de Asuntos Humanitarios de las Naciones Unidas (UN OCHA).

- **Volumen y perfiles:** Especialmente valioso para perfiles corporativos, institucionales y de gestión en organismos internacionales, agencias de la ONU y organizaciones no gubernamentales (ONGs):
  - *Administración y Finanzas* (Administration/Finance, Financial Management, Accounting, Grant Management)
  - *Recursos Humanos y Personas* (Human Resources, Staff Welfare)
  - *Asuntos Legales y Derechos Humanos* (Protection/Human Rights, Legal Advice, International Humanitarian Law)
  - *Comunicaciones y Relaciones Institucionales* (Advocacy/Communications, Public Information, Media Relations)
  - *Operaciones, Logística y Comex* (Logistics/Procurement, Supply Chain, Operations Management)
  - *Gestión de Programas y Proyectos* (Program/Project Management, Monitoring & Evaluation)
- **Cobertura geográfica y relevancia para LATAM:**
  - Cobertura global integral con fuerte presencia en América Latina y el Caribe (misiones y oficinas regionales en Colombia, Venezuela, Haití, Perú, Ecuador, México, Centroamérica y el Cono Sur).
  - Publica avisos multilingües, con gran presencia de ofertas redactadas en español y en inglés.
  - Ofrece modalidades presenciales en sedes de organismos internacionales y posiciones remotas globales o basadas en país de residencia (*home-based / teleworking*).

---

## 2. Endpoint y API técnica

ReliefWeb ofrece una API REST oficial v2 pública y extensamente documentada.
*(Nota técnica: el endpoint histórico v1 `api.reliefweb.int/v1/jobs` fue discontinuado definitivamente y responde HTTP 410 Gone).*

- **URL base:** `https://api.reliefweb.int/v2`
- **Endpoint principal:** `GET https://api.reliefweb.int/v2/jobs` (o mediante `POST` con cuerpo JSON para consultas complejas).
- **Parámetros principales de consulta:**
  - `appname`: **Obligatorio**. Identificador de la aplicación que realiza las llamadas (ej. `?appname=job-search-os`). OCHA monitorea el uso mediante este parámetro.
  - `limit`: Cantidad de resultados a devolver por página (entero entre 1 y 1000; por defecto 10).
  - `offset`: Desplazamiento numérico para paginación tradicional por offset.
  - `query[value]`: Término de búsqueda de texto libre.
  - `filter[field]` y `filter[value]`: Filtros estructurados sobre taxonomías del sistema (ej. por país, estado `published`, categoría o tipo de contrato).
  - `profile`: Perfil de datos devueltos (`list`, `minimal` o `full`). Para obtener el cuerpo íntegro del aviso se utiliza `profile=full` o el parámetro `fields`.
  - `fields[include][]`: Selección granular de campos en la respuesta (`title`, `body`, `url`, `date.created`, `source`, `country`, `career_categories`, `job_type`, `experience`, `how_to_apply`).
  - `sort[]`: Criterio y dirección de ordenamiento (ej. `date.created:desc`).
- **Endpoint individual:** `GET https://api.reliefweb.int/v2/jobs/{id}`.

### Formato de respuesta (JSON)
```json
{
  "time": 45,
  "totalCount": 3200,
  "count": 1,
  "data": [
    {
      "id": "4098765",
      "score": 1,
      "fields": {
        "title": "Finance and Administration Officer",
        "body": "Detailed job terms and duties in markdown or formatted text...",
        "url": "https://reliefweb.int/job/4098765/finance-and-administration-officer",
        "date": {
          "created": "2026-10-29T10:15:00+00:00",
          "closing": "2026-11-20T23:59:00+00:00"
        },
        "source": [
          {
            "id": 123,
            "name": "United Nations High Commissioner for Refugees",
            "shortname": "UNHCR"
          }
        ],
        "country": [
          {
            "id": 61,
            "name": "Colombia",
            "iso3": "COL"
          }
        ],
        "career_categories": [
          {
            "id": 6861,
            "name": "Administration/Finance"
          }
        ],
        "job_type": {
          "id": 264,
          "name": "Staff"
        },
        "how_to_apply": "Applications must be submitted via UNHCR careers portal..."
      }
    }
  ]
}
```

---

## 3. Registro necesario y límites de tasa (Rate Limits)

- **Parámetro `appname`:** Es un requisito estricto de la plataforma. Toda llamada debe incluir `?appname=NOMBRE_APLICACION`. El registro y especificación se realiza ante el equipo de UN OCHA vía su portal de desarrolladores (`https://apidoc.rwlabs.org/`).
- **Autenticación:** No utiliza API keys secretas ni tokens OAuth; el parámetro público `appname` y las cabeceras estándar de `User-Agent` actúan como identificadores de consumo.
- **Límites de tasa:** No se publica un límite duro por minuto, pero la política de OCHA exige un consumo razonable y no abusivo (típicamente hasta 1000 registros por llamada, con pausas entre lotes). Está diseñada para soportar interoperabilidad y agregación abierta sin fines lucrativos especulativos.

---

## 4. Términos de servicio citados y aspectos legales

Fuentes consultadas:
- [ReliefWeb API Documentation & Terms](https://apidoc.rwlabs.org/)
- [ReliefWeb Terms and Conditions](https://reliefweb.int/terms-and-conditions)

### Puntos clave de los términos y licenciamiento:
1. **Licencia abierta (CC BY 4.0):** El contenido propio y la infraestructura informativa de ReliefWeb están generalmente licenciados bajo **Creative Commons Attribution 4.0 International (CC BY 4.0)**, permitiendo su compartición y adaptación con adecuada atribución.
2. **Derechos de terceros y organizaciones contribuyentes:** La mayoría de los avisos de empleo son proporcionados por organizaciones socias (agencias de la ONU, ONGs internacionales, Ministerios de Cooperación). ReliefWeb advierte expresamente que los usuarios de la API deben **respetar los derechos y condiciones de los proveedores originales de contenido**.
3. **Requisito de atribución:** Toda aplicación que muestre o distribuya datos obtenidos de ReliefWeb debe citar claramente a ReliefWeb y/o a la organización contratante original, proporcionando el enlace directo a la oferta original (`fields.url`).
4. **Protección de emblemas y marcas de la ONU:** El nombre y los emblemas de la ONU y de UN OCHA están protegidos por el derecho internacional. El uso de la API no autoriza sugerir patrocinio, alianza o aval formal por parte de Naciones Unidas.

---

## 5. Mapeo preliminar a RawJob

| ReliefWeb (v2) | RawJob | Notas |
|---|---|---|
| `id` | `source.externalId` | Almacenado como string. |
| `fields.url` | `source.url` | URL original de la publicación en ReliefWeb. |
| `fields.title` | `title` | Título de la vacante. |
| `fields.source[0].name` | `companyRaw` | Nombre de la ONG o agencia internacional (ej. "UNICEF", "Oxfam"). |
| `fields.body` | `jdText` | Texto descriptivo completo de la vacante. |
| `fields.date.created` | `postedAt` | Fecha de publicación en formato ISO 8601. |
| `fields.country` | `locationRaw`, `countriesAllowed` (con recaudos) | `fields.country` indica dónde opera o radica la oficina/misión. Si el puesto es presencial, mapea a `countriesAllowed` (`"COL"` → `["CO"]`). Si se clasifica como remoto (*home-based*), **no asumir** restricción exclusiva a ese país salvo que la descripción lo exija expresamente; si no se especifica restricción de residencia, dejar `countriesAllowed: null` (para que el prefiltro lo marque como riesgo y no active el bloqueo de país de la regla H-1 / PR #300). |
| `fields.career_categories` | `categories`, `tags` | Clasificación profesional oficial. |
| `fields.job_type.name` | `contractType` | Ej. `"Staff"`, `"Consultancy"`, `"Internship"`. |
| Modalidad de trabajo | `modality` | Si la descripción o país indica "Home-based" o teletrabajo → `modality: "remoto"`; si está asignado a un país/sede física → `modality: "presencial"` o `"hibrido"`. |
| Objeto completo | `source.original` | Registro íntegro del item para auditoría. |

---

## 6. Esfuerzo de implementación

- **Nivel de esfuerzo:** **Bajo a Medio** (estimado en 1 a 2 jornadas de desarrollo).
- **Ventajas:**
  - API v2 moderna, robusta y con excelente documentación de endpoints y filtros.
  - Soporte nativo de filtrado por países (`country.iso3`), permitiendo consultar puestos en países de LATAM o puestos globales.
  - Descripción íntegra disponible en la misma respuesta (`fields[include][]=body`), eliminando llamadas de detalle N+1.
  - Taxonomía de carreras muy cercana a las carreras de AfiniaJobs (administración, finanzas, protección/legal, comunicación).
- **Consideraciones:**
  - La inmensa mayoría de las publicaciones son posiciones de terreno, base de operaciones o sede física presencial.
  - Para alimentar un buscador orientado a trabajo remoto, requiere filtrar estrictamente puestos con mención de *home-based*, teletrabajo o consultoría externa no presencial.

---

## 7. Recomendación para Mauro

1. **Evaluar la integración mediante medición previa:**
   - La plataforma es de muy alta calidad institucional para carreras no tecnológicas (ciencias sociales, administración, finanzas, legal, comex).
   - Sin embargo, **antes de crear el adapter se recomienda medir con una consulta real a la API v2** (`query[value]=home-based` o `query[value]=remote` con filtros por categorías y países de LATAM) cuántas ofertas remotas reales en español o inglés publica por semana, para confirmar si el volumen justifica el mantenimiento del adapter.
2. Si los números confirman volumen útil:
   - Registrar el identificador `appname` (ej. `job-search-os-afinia`) en la documentación de ReliefWeb (`https://apidoc.rwlabs.org/`).
   - Crear el adapter `packages/adapters/src/sources/reliefweb.ts` utilizando la API v2 con filtros estructurados.
   - Diseñar la heurística cuidadosa de `modality` y `countriesAllowed` (ver sección 5).
   - Agregar `reliefweb` al enum de fuentes y a `POOL_SOURCES`.

