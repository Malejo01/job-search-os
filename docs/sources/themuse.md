# Fuente: The Muse · NO integrada

Ficha técnica de prospección (ticket G-6, 2026-10-30). **Todavía no hay adapter ni código en el repositorio.** No se integra sin la aprobación de Mauro y sin verificar las condiciones vigentes de su API. No constituye asesoramiento legal.

---

## 1. Qué ofrece y cobertura

The Muse (operado por FGB Muse Group Inc.) es una plataforma estadounidense de búsqueda de empleo y cultura empresarial.

- **Volumen y perfiles:** Amplia oferta en roles corporativos y profesionales no tecnológicos que coinciden con las carreras prioritarias de AfiniaJobs:
  - *Marketing y Publicidad* (Brand, Performance, Content, Social Media)
  - *Finanzas y Contabilidad* (Accounting, Financial Analyst, Auditing, Tax)
  - *Legales y Cumplimiento* (Legal Counsel, Compliance, Contracts)
  - *Administración y Gestión* (Operations, Business Development, Project Management)
  - *Recursos Humanos* (HR Generalist, Talent Acquisition, People Ops)
- **Cobertura geográfica:**
  - Gran concentración en empresas con sede en Estados Unidos.
  - Cuenta con un volumen creciente de posiciones remotas clasificadas bajo `location: "Flexible / Remote"`.
  - **A verificar para LATAM:** Muchas ofertas remotas están restringidas a residentes fiscales en EE. UU. o Canadá (requisito de autorización laboral en EE. UU.). Para AfiniaJobs en América Latina se requiere filtrar estrictamente los avisos que admitan contratación internacional o contratista independiente.

---

## 2. Endpoint y API técnica

The Muse cuenta con una API REST pública documentada para desarrolladores. *(Datos extraídos de la documentación oficial `https://www.themuse.com/developers/api/v2`; pendientes de verificación empírica en llamada real).*

- **URL base:** `https://www.themuse.com/api/public` (la URL heredada `https://api-v2.themuse.com` redirige a esta).
- **Endpoint principal:** `GET https://www.themuse.com/api/public/jobs`
- **Parámetros principales de consulta:**
  - `page`: Número de página para paginación (entero, típicamente base 0 o 1; cada página devuelve hasta 20 resultados).
  - `category`: Permite filtrar por una o más categorías profesionales (ej. `Marketing`, `Finance`, `Legal`, `Human Resources`, `Business & Strategy`).
  - `level`: Nivel de seniority (`Entry Level`, `Mid Level`, `Senior Level`, `Management`).
  - `location`: Filtro de ubicación geográfica (ej. `Flexible / Remote`).
  - `company`: Filtrado por empresa específica.
  - `api_key`: Clave de aplicación registrada (opcional; amplía los límites de tasa).
- **Endpoint individual:** `GET https://www.themuse.com/api/public/jobs/{id}` (detalle por ID numérico).

### Formato documentado de respuesta (JSON de ejemplo según spec)
Devuelve un objeto JSON con metadatos de paginación y la lista de resultados:
```json
{
  "page": 0,
  "page_count": 45,
  "total": 890,
  "results": [
    {
      "id": 1234567,
      "name": "Senior Financial Analyst",
      "contents": "<p>Job description in HTML...</p>",
      "type": "External",
      "publication_date": "2026-10-28T18:00:00Z",
      "company": {
        "id": 4321,
        "name": "Acme Corp",
        "short_name": "acme"
      },
      "locations": [
        { "name": "Flexible / Remote" }
      ],
      "categories": [
        { "name": "Finance" }
      ],
      "levels": [
        { "name": "Mid Level" }
      ],
      "refs": {
        "landing_page": "https://www.themuse.com/jobs/acme/senior-financial-analyst-1234567"
      }
    }
  ]
}
```

---

## 3. Registro necesario y límites de tasa (Rate Limits)

- **Uso anónimo (sin API key):** Permitido para pruebas y bajo volumen. Límite de **500 peticiones por hora**.
- **Uso registrado (con API key):** Registro gratuito a través del portal de desarrolladores de The Muse (`https://www.themuse.com/developers/api/v2`). Proporciona una clave que se envía por query string (`?api_key=TU_KEY`) y eleva el límite a **3.600 peticiones por hora**.
- **Cabeceras de control:** La API devuelve en cada respuesta:
  - `X-RateLimit-Limit`: Cuota horaria asignada.
  - `X-RateLimit-Remaining`: Peticiones disponibles en la ventana actual.
  - `X-RateLimit-Reset`: Segundos restantes hasta el reinicio de la ventana.

---

## 4. Términos de servicio citados y aspectos legales

Fuentes consultadas:
- [The Muse Terms of Use](https://www.themuse.com/terms)
- [The Muse Developer Portal](https://www.themuse.com/developers/api/v2)

### Puntos clave de los términos:
1. **Ausencia de acuerdo separado de API:** The Muse no dispone de un contrato de licencia para desarrolladores independiente; el acceso a la API se rige bajo los Términos de Uso generales de la plataforma.
2. **Prohibición de scraping no autorizado:** Los términos prohíben expresamente el uso de scrapers, spiders, robots de extracción masiva o herramientas de minería de datos contra la interfaz web HTML del sitio. El acceso a través de la API oficial es el único canal autorizado.
3. **Atribución y enlaces originales:** Cualquier visualización o indexación de puestos debe incluir la mención de The Muse y el enlace directo al aviso original provisto en `refs.landing_page`.
4. **Propiedad intelectual:** La descripción de los puestos y el material de marca pertenecen a las empresas publicantes o a The Muse. No se permite la reventa directa de la base de datos ni su utilización para entrenar modelos propietarios sin autorización.

---

## 5. Mapeo preliminar a RawJob

| The Muse | RawJob | Notas |
|---|---|---|
| `id` (numérico) | `source.externalId` | Convertido a string. |
| `refs.landing_page` | `source.url` | Enlace canónico de postulación/visualización. |
| `name` | `title` | Título del puesto. |
| `company.name` | `companyRaw` | Razón social o nombre público del empleador. |
| `contents` (HTML) | `jdText` | Convertido con `htmlToText` de la aplicación. |
| `publication_date` | `postedAt` | Timestamp ISO 8601. |
| `locations` | `locationRaw`, `countriesAllowed`, `modality` | Si contiene `"Flexible / Remote"` → `modality: "remoto"`. Si especifica ciudades/estados de EE. UU. sin mención remota → `modality: "presencial"` y `countriesAllowed: ["US"]`. |
| `levels` | `seniority` | Mapeo de `Entry Level`, `Mid Level`, `Senior Level`. |
| `categories` | `categories`, `tags` | Mapeo conceptual a carreras en el pipeline. |
| Respuesta completa | `source.original` | Almacenamiento íntegro del item para trazabilidad. |

---

## 6. Esfuerzo de implementación

- **Nivel de esfuerzo:** **Bajo a Medio** (estimado en 1 a 2 jornadas de desarrollo).
- **Ventajas:**
  - Formato JSON estructurado y predecible.
  - La descripción completa (`contents`) viene en el listado, evitando llamadas HTTP adicionales por cada aviso.
  - Paginación tradicional por índice de página (`page`).
  - No requiere OAuth complejo ni renovación periódica de tokens de sesión; una API key estática o consumo anónimo controlado es suficiente.
- **Riesgos y mitigaciones:**
  - Filtrado de elegibilidad para LATAM: requiere heurísticas de ubicación para no inundar el pool con avisos presenciales o restringidos a residentes legales de EE. UU.

---

## 7. Recomendación para Mauro

1. Evaluar si el volumen de puestos remotos elegibles para candidatos en América Latina justifica sumar la fuente frente a las fuentes del pool ya existentes orientadas a la región o a trabajo remoto (Get on Board, Torre, WWR, Jobicy). (Nota: LinkedIn no forma parte del pool del scraper conforme a ADR-004, solo de reenvío de emails).
2. Si se decide avanzar:
   - Realizar una corrida exploratoria de prueba contra el endpoint con `location=Flexible%20/%20Remote` para medir qué porcentaje de los avisos admite contratación de contratistas independientes fuera de EE. UU.
   - Registrar una API key en `themuse.com/developers` para contar con el cupo documentado de 3.600 req/h (frente al límite anónimo de 500 req/h).
   - Implementar el adapter en `packages/adapters/src/sources/themuse.ts` filtrando por categorías afines.
   - Agregar `themuse` al enum de fuentes de la base de datos mediante migración y habilitarla detrás de la variable `POOL_SOURCES`.

