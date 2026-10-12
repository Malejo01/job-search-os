# Panel de usuarios simulados · resumen (ronda 32, 2026-10-09)

## Archivos
- **Este resumen.**
- **Un informe por persona:** `comercio.md`, `bootcamp.md`, `uxui.md`, `qa.md`, `datos.md`, `soporte.md` y `aieng.md`.
- **Revisiones transversales:** `seguridad.md` y `accesibilidad.md`.
- **Personas:** `fichas.md`.

Las capturas y las JDs sintéticas quedaron en las notas locales de la ronda.

## Cómo se hizo
- **Personas:** 7 sintéticas (fichas en `fichas.md`): comercio→QA, bootcamp full-stack, UX/UI, QA, contabilidad→datos, soporte IT y AI engineer. Cada una recorrió la app con Playwright:
  - registro por invitación → onboarding → skills → asistente;
  - cargar 3 a 5 JDs sintéticas → detalle → `/market` → `/plan` → cambiar una skill → `/market` y `/plan` de nuevo → Ajustes.
- **Transversales:** dos revisores, seguridad y privacidad (lectura cruzada, datos expuestos, inputs) y accesibilidad (teclado, foco, contraste, árbol de accesibilidad; sin axe, que no está instalado).
- **Entorno:**
  - app local en modo desarrollo sobre la rama de la ronda 31, que incluye la 28 (skills autodeclaradas) y la taxonomía nueva, sin la 29, que no cambia nada visible;
  - base local con datos sintéticos y LLM en **modo demo**: las evaluaciones son de prueba, y los hallazgos sobre su contenido se marcan "a verificar con el modelo real";
  - gasto LLM: USD 0.
- **Primera ingesta:** como en producción, al terminar el onboarding trae ofertas reales de la fuente por API. Los informes no las nombran y las capturas no se versionan.

## Top 10 por severidad
| # | Severidad | Hallazgo | Quiénes lo vieron | Dónde |
|---|---|---|---|---|
| 1 | **Bloqueante** | **Los criterios de fábrica solo permiten disciplinas de desarrollo** (IA, Fullstack, Frontend, Backend, Arquitectura). Las ofertas de QA, soporte, diseño y datos salen con "disciplina distinta", el score recortado a 4 y "Descartar". No hay disciplinas de QA, soporte ni diseño, y elegir el rol en skills no toca los criterios | 6 de 7 | `DEFAULT_CRITERIA_RULES` (`pipeline/src/onboarding.ts`), `decide()` |
| 2 | **Bloqueante** | **El prefiltro descarta toda oferta híbrida o presencial sin mirar el perfil.** "Busco solo trabajo remoto" viene marcado y desmarcarlo no cambia nada. La oferta queda "Descartada (prefiltro)" con `modalidad_no_remota`, sin evaluar y sin "Evaluar igual" | 6 de 7 | `pipeline/src/prefilter/prefilter.ts:183` (verificado) |
| 3 | **Bloqueante** | **Bloqueadores que contradicen la evaluación:**<br>• "años en otro dominio (soporte IT)" para quien es de soporte;<br>• el mismo ítem como bloqueador y como match fuerte;<br>• "Excelente match" con score 3.<br>Muchos derivan del #1 (la disciplina del aviso queda fuera de las permitidas) | 6 de 7 | `decide()` (years_domain / discipline) y prompt. A verificar con el modelo real |
| 4 | Importante | **La penalización por inglés avanzado o nativo ignora el CEFR de la persona:** una persona C1 pierde 1 punto en una oferta que pide avanzado. Los criterios de fábrica de los invitados traen `english_fluent_penalty: 1` | 1 (control) | `pipeline/src/decide.ts:246-256` (verificado) |
| 5 | Importante | **`/market` y `/plan` sin foco en el rol:**<br>• las 7 ofertas de la fuente (desarrollo y datos) dominan los gaps de todos;<br>• el plan lista entre 26 y 33 skills (500 a 770 h) con "~0 h para cerrar" (falta el dato) y "sin recurso aprobado" en casi todas;<br>• no hay recursos para datos, soporte ni diseño | 7 de 7 | `lib/market.ts`, `lib/plan.ts`, `buildPlan`, catálogo de recursos |
| 6 | Importante | **El mercado no se recalcula cuando llegan ofertas** (pegadas o por email): solo al guardar skills o el lunes, y la nota está escondida en "¿Cómo se calcula?". Hueco del diseño de la ronda 28 | 3 | `scheduleMarketRecompute` solo en onboarding y skills |
| 7 | Importante | **Las ofertas de la primera ingesta quedan "Evaluando…".** En producción, el cron de evaluación corre cada 6 h (`cron.yml`): un invitado puede esperar hasta 6 h sin scores, con esas ofertas arriba de las suyas | 7 de 7 | onboarding → cola; `cron.yml` |
| 8 | Importante | **Jerga y códigos internos a la vista:** `location_risk`, `modalidad_no_remota`, `discipline_cap -4`, `english_fluent_penalty`, `creative_production`, `no_menciona`, el nombre del modelo y la versión del prompt, `applicant:sync`, `no_route`, "PRD/baseline" en `/applications`, categorías `ai_core`/`framework` | 7 de 7 | detalle, `/jobs`, `/market`, `/plan`, formulario, `/applications` |
| 9 | Importante | **Sin salida para corregir:**<br>• no hay "Perfil" en Ajustes (país, inglés, solo remoto, resumen);<br>• no hay "Evaluar igual" en las descartadas;<br>• "Marcar aplicada" es el botón principal en ofertas con bloqueadores y "Descartar" | 7 de 7 | `/settings`, detalle |
| 10 | Importante | **Robustez de formularios:**<br>• doble clic en "Crear cuenta": crea la cuenta y muestra "invitación inválida o vencida";<br>• doble clic en "Cargar oferta" duplica la fuente;<br>• registro, login y criterios borran lo escrito al fallar;<br>• un id malformado da 500 (`/jobs/…`, `/inbox/…`) y el 404 está en inglés;<br>• falta validar en el servidor las URLs del alta manual (detalle en las notas privadas) | 3 + seguridad | registro, `/jobs/new`, `[id]/page.tsx` |

**Siguen (importantes):**
- **Menú y encabezado** cortados en el celular (390 px) y filtros que ocupan media pantalla.
- **Buscador de skills:**
  - oculta lo que ya está en la lista y dice "No hay skills con ese nombre";
  - busca por subcadena ("excel" trae Inglés por el alias "excellent english");
  - no tiene sinónimos en español;
  - Mis skills no recuerda el rol.
- **Taxonomía:** faltan HTML/CSS, Playwright, Postman, Jira, Git, Microsoft 365 y PowerShell.
- **Pre-score engañoso** antes de la evaluación (7 u 8 para ofertas que después dan 2 a 5).
- **El evaluador no recibe los niveles de skills:** gaps "(must)" que la persona declaró tener. A verificar con el modelo real.
- **Ejemplos y textos pensados para desarrolladores:**
  - el ejemplo del resumen;
  - el asistente nombra solo portales de desarrollo y asume Gmail de escritorio;
  - "años de experiencia" no dice si es en el rol;
  - el inglés como skill repite el CEFR.

**Seguridad:** sin lectura cruzada ni datos ajenos expuestos (`seguridad.md`). Los dos importantes son de validación de URLs en el alta manual (#10).

**Accesibilidad** (`accesibilidad.md`):
- **3 incumplimientos de nivel A, baratos de arreglar:**
  - atajos de una sola tecla (j/k/n) en el detalle;
  - sin "Saltar al contenido";
  - el mismo `<title>` en todas las pantallas.
- **Nivel AA:**
  - contraste de `text-zinc-400`/`500` en texto chico y de los bordes de inputs (`zinc-300`);
  - foco recortado en el menú del celular;
  - errores de formulario sin `aria-invalid`.
- **El mejor ejemplo del producto** es la pantalla de skills de la ronda 28.

## Antes del lunes 12/10 (recomendado, en este orden)
1. **Criterios de fábrica neutros (#1 y gran parte del #3):**
   - para usuarios nuevos, `allowed_disciplines` con **todas** las disciplinas del enum, o derivadas del rol elegido en skills;
   - sin "salario de referencia" si la persona no lo cargó;
   - `english_fluent_penalty: 0`.
   Es código (`DEFAULT_CRITERIA_RULES`), más un `UPDATE` puntual en Neon para los invitados ya creados.
2. **Prefiltro de modalidad según el perfil (#2):** si `remote_only` es falso, híbrida y presencial pasan, como riesgo. El casillero sin marcar por defecto. Motivo del descarte en llano.
3. **Penalización de inglés con el CEFR (#4):** una condición en `decide.ts`, con test.
4. **Doble envío y validación de ids (#10):** `useFormStatus` para deshabilitar los botones de envío, `notFound()` con un id inválido y validación de URLs en el alta manual.
5. **Textos (#8, la parte más visible):**
   - motivos del prefiltro y chip `location_risk` en llano;
   - "~0 h" → "sin estimar";
   - ocultar el modelo y los códigos del formulario de postulación.
6. **Accesibilidad de nivel A:** "Saltar al contenido", títulos por ruta y atajos j/k/n con modificador. Más el contraste de `text-zinc-400` en texto chico. Todo de esfuerzo bajo.
7. **Expectativa de evaluación (#7):** "Se evalúan en las próximas horas" en las ofertas en cola, o evaluar la primera ingesta enseguida con el tope de costo por usuario (pide OK de gasto).

## Después del lunes
- **Mercado y plan por rol (#5):** filtrar o ponderar por las disciplinas y el rol, mostrar un top 5 con "ver el resto" y sumar recursos de datos, soporte y diseño.
- **Recálculo al llegar ofertas (#6),** con el mismo límite.
- **Perfil en Ajustes, "Evaluar igual" y jerarquía de botones con bloqueadores (#9).**
- **Buscador de skills:** prefijo o palabra, mostrar las ya listadas, sinónimos en español; recordar el rol (ahí sí hace falta guardar el rol: campo nuevo, migración).
- **Taxonomía, segunda tanda (JS-133 bis):** HTML/CSS, Playwright, Postman, Jira, Git, Microsoft 365 y PowerShell.
- **Pasarle al evaluador los niveles de skills** y agrupar bloqueadores repetidos. Lleva cambio de prompt y evals pagos.
- **Disciplinas nuevas en el enum** (QA, soporte, diseño): migración.
- **Celular:** menú en dos renglones o hamburguesa, filtros plegados, títulos en 2 líneas.
- **Ejemplos por perfil** en el onboarding y el asistente con otros portales (sin prometer parsers que no existen).

## Lo que funcionó bien (consenso)
- **Registro, onboarding y carga de skills:** sin trabas, en 6 a 12 minutos, sin ayuda. Los 4 niveles en palabras gustaron a todas las personas.
- **Guardar skills actualiza `/market` y `/plan` en unos 15 s**, y el aviso lo anticipa: la ronda 28 funciona.
- **El catálogo de skills nuevas de la 31** aparece bien para UX/UI, Soporte IT y Data Analyst.
- **La estructura de la evaluación** (bloqueadores, riesgos, match, gaps, veredicto en segunda persona) se entiende; falla por los datos que la alimentan.
- **Seguridad:** sin lectura cruzada ni datos ajenos; el HTML y los caracteres especiales en títulos y JDs se muestran literales.
