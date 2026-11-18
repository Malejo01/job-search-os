# ADR-039: Jooble como fuente del pool de Argentina (propuesta, adaptador apagado)

**Status:** Proposed · **Date:** 2026-11-18 · **Amplía:** ADR-014, ADR-018 y ADR-024 · **Relacionada:** ADR-036

## Context
- La beta necesita ofertas locales en español de carreras no tech. Las fuentes del pool con API
  casi no las tienen (ADR-024), y las alertas por email cubren solo Computrabajo (ADR-024) y, a
  nivel personal, Bumeran (ADR-035, ADR-036 §Bloqueo).
- Jooble es un agregador de avisos de muchos portales y ofrece una API para editores. Al ser un
  agregador, cada aviso trae el link al portal de origen: es lo que le faltaba a Bumeran en ADR-036.
- Esta ADR deja escrito cómo entraría Jooble al pool. **El adaptador existe pero queda apagado: no se
  hace ninguna llamada hasta que el dueño del proyecto se registre, cargue la clave y lo prenda.**
- Nada de lo que sigue sobre el formato de la API o sus condiciones se probó contra la API real.
  Sale de la documentación pública y está marcado **a verificar al registrarse** donde corresponde.

## Qué devuelve la API (a verificar al registrarse)
Una consulta es un POST con JSON (palabras, ubicación, página) a un endpoint que lleva la clave en
el path. La respuesta es un objeto con `totalCount` y `jobs`, y cada aviso trae:

| Campo de Jooble | Se usa como | Si falta |
|---|---|---|
| `title` | título | se descarta el aviso |
| `company` | empresa | `desconocida` |
| `location` | ubicación (texto) | `null` |
| `snippet` | solo en el crudo guardado; **no** es la descripción | n/a |
| `salary` | nota de sueldo (texto libre, sin convertir a USD) | `null` |
| `source` | solo en el crudo (el portal de origen) | n/a |
| `type` | tipo de contrato | `null` |
| `link` | link al aviso original (http/https) | se descarta el aviso |
| `updated` | fecha de publicación | `null` |
| `id` | `external_id` (`jooble:<id>`) | se descarta el aviso |

A verificar al registrarse: nombres y tipos exactos de los campos, si `id` es número o texto, si
`updated` trae zona horaria (hoy se toma como UTC), cuántos avisos devuelve por página, si el
`link` es el del portal de origen o uno de seguimiento de Jooble, si se puede filtrar por país o por
fecha, y si el `snippet` viene con marcas HTML (el adaptador las quita).

## Decision
1. **Fuente del pool, apagada por defecto.** Participa solo si `jooble` está en `POOL_SOURCES` **y**
   hay `JOOBLE_API_KEY`. Sin clave no hace ninguna llamada y no devuelve ofertas (falla cerrado).
   Para apagarla, sacar `jooble` de la variable.
2. **Falla cerrado en la forma.** Si la respuesta no es un objeto con `jobs` array, o algún aviso
   trae un campo con tipo equivocado, se descarta la página entera: nunca extracción parcial ni campos
   inventados. Un aviso sin id, título o link http(s) se salta solo. Lo que la API no dice queda
   `null`; en particular `countriesAllowed`, para que el prefiltro marque riesgo de ubicación en vez
   de asumir «cualquier país», y `modality` queda `desconocida`.
3. **Condiciones de uso.** Cada oferta dice «vía Jooble» y postular lleva al link original que
   devuelve la API; la app nunca postula por la persona (ADR-004). No se sigue el link desde el
   servidor ni se baja la página del aviso (ADR-024 §5, D-028). Como en ADR-024 §3: solo con sesión
   iniciada, nada de Jooble en vitrina, `/ofertas`, `/mercado`, demo ni SEO. Las condiciones exactas
   (si piden atribución con logo, si permiten guardar los avisos más de un tiempo, si prohíben mostrar
   los datos fuera de una búsqueda del usuario) son **a verificar al registrarse**. Si alguna choca
   con el pool (retención de 30 días de ADR-014), se ajusta la retención de esta fuente o no se
   prende.
4. **Tope de 100 consultas por día.** Es el límite que se asume para la cuenta (a verificar al
   registrarse: es lo que se sabe hoy). Se respeta en tres capas:
   - **Plan por corrida** (`planJoobleQueries`): como mucho 15 consultas por corrida, una página por
     consulta, con las dos primeras palabras en español de cada carrera de `portal-guide.ts`, intercaladas
     y rotadas para cubrir todas las carreras a lo largo del día.
   - **Intervalo mínimo** de 5 horas entre corridas: como mucho 5 corridas por día, o sea 75
     consultas y un margen de 25 para pruebas manuales. Un test verifica que ese peor caso no pase de
     100.
   - **Tope duro en el cliente** (`fetchJoobleJobs`): nunca hace más de `min(pedido, 100)` consultas, aun
     si le pasan un plan más largo. Ante un 429 u otro error HTTP se detiene en la primera consulta fallida.
   Lo que no cubre: el conteo de consultas hechas por otras vías (pruebas manuales, otra instancia). El
   contador del día lo lleva Jooble; si lo superamos, devuelve error y la fuente queda en `partial`.
5. **Pendiente de descripción.** La API da solo un fragmento. El fragmento **no** se guarda como
   `jdText`: la oferta entra con `jdText = null`, igual que las de los emails (ADR-024 §5), y sigue el
   flujo de «Sin descripción»: la persona abre el aviso original y pega el texto completo. Así el
   evaluador nunca puntúa una descripción recortada como si fuera completa. El fragmento queda en el
   crudo guardado.
6. **Privacidad.** El pool no guarda datos de personas (ADR-014). El pool le saca emails y teléfonos al
   texto antes de guardar. La clave viaja en el path de la URL: la URL nunca se escribe en un log ni en
   un mensaje de error (el adaptador informa solo el número de estado HTTP).
7. **Contenido externo es dato, no instrucción.** Título, empresa y fragmento de Jooble se tratan
   como texto de terceros: no se interpretan ni se inyectan HTML en pantalla.

## Qué falta para prenderla (no se hace en esta ADR)
- **Ya está cableada, sin migración.** `jooble` figura en `POOL_SOURCE_NAMES`, `POOL_SOURCE_KIND`,
  `POOL_MIN_INTERVAL_MS` (5 h), los topes de tiempo y `POOL_DOWNLOADERS` de
  `packages/adapters/src/pool/fetch.ts`. No está en `POOL_RECOMMENDED_SOURCES`. El interruptor es
  `jooble` en `POOL_SOURCES` más `JOOBLE_API_KEY`: sin la clave el downloader devuelve vacío sin
  llamar a la red.
- **`source_kind = other`, sin valor propio en el enum.** Vale mientras Jooble sea la única fuente
  del pool con ese valor, porque el intervalo mínimo y el historial de corridas se calculan por
  `source_kind`. Si entra otra fuente con `other` (por ejemplo ReliefWeb, ADR-028), hace falta darle
  a una de las dos su propio valor del enum con su migración. El `RawJob` lleva
  `source.kind = "other"` y `source.name = "Jooble"`.
- **«vía Jooble» todavía no se lee en pantalla.** El detalle de la oferta ya muestra el nombre de la
  fuente (`Jooble`) y el link al aviso original en la lista «Fuentes»
  (`apps/web/app/(app)/jobs/[id]/page.tsx`), pero la atribución con la palabra «vía»
  (`source-attribution.tsx` → `attributionFor`) se decide por `source_kind`, y `other` no tiene
  ninguna. Hace falta un cambio chico, aparte de esta ADR, para que las fuentes `other` con nombre
  conocido digan «vía <fuente>». **Condición para prender la fuente.**
- Un `--dry-run` con la clave real antes de prenderla, para verificar lo marcado «a verificar».
- Nada de esto se probó contra la API real: los tests usan un `fetch` falso y datos inventados.

## Ampliación R16-1: Careerjet (adaptador apagado)
Misma idea que Jooble, con la API pública de Careerjet para Argentina (`locale_code=es_AR`). Adaptador en
`packages/adapters/src/pool/careerjet.ts`, apagado, sin migración y sin ninguna llamada hasta que el dueño
del proyecto lo prenda. Se escribió con fixtures inventadas; **nada se probó contra la API real**.

### BLOQUEO para prender la fuente: la API espera una persona y el pool no la tiene
La API de Careerjet pide, en cada consulta, la IP y el navegador de la persona que busca y la URL de la
página donde se muestra el aviso. El pool corre en un cron: **no hay ninguna persona del otro lado.** El
adaptador no inventa una IP ni un navegador y no manda los de una persona real:
- `user_ip` sale de la variable `CAREERJET_CALLER_IP`, la IP de **este servidor** (tiene que ser una IP
  válida; sin ella, la fuente no hace nada). No hay valor por defecto.
- `user_agent` es el identificable de la app (el mismo que usan las demás fuentes del pool), no el de un navegador.
- `url` sale de `SITE_URL` (solo el origen). Sin `SITE_URL`, la fuente no hace nada.

**Antes de prenderla hay que confirmar con Careerjet, por escrito, que el uso desde un servidor, sin visitante,
está permitido.** Si exigen el visitante real (su IP y su navegador), esta fuente **no se puede usar para el pool**
y el adaptador se descarta o se reencauza a una búsqueda iniciada por la persona (decisión aparte, con su propio ADR).

### Qué hace el adaptador
1. **Apagada y falla cerrado.** Participa solo si `careerjet` está en `POOL_SOURCES` **y** hay `CAREERJET_AFFID`
   **y** `CAREERJET_CALLER_IP` **y** `SITE_URL`. Si falta cualquiera, cero llamadas y cero ofertas.
2. **Forma.** Una respuesta que no es un objeto con `jobs` en lista, o con un campo de tipo equivocado, se
   descarta entera (también las de error o de ubicación ambigua, que no traen `jobs`). Un aviso sin título o sin
   link http(s) se salta solo. Lo que la API no dice queda `null`: `countriesAllowed`, tipo de contrato,
   `modality` `desconocida`.
3. **Pendiente de descripción.** El campo `description` es un fragmento: no va a `jdText`, queda en el crudo.
4. **Id del aviso.** El `id` de la API si lo trae; si no, un hash estable del link. A verificar si Careerjet da un id propio.
5. **Consultas por carrera** con las palabras de `portal-guide.ts` (el mismo plan de Jooble), una página por
   consulta, 15 por corrida, intervalo de 5 h y tope duro de 100 por día. **El tope de Careerjet es un supuesto**:
   copiado de Jooble hasta saber el real.
6. **Secretos.** El afiliado viaja en la query: la URL nunca se escribe en un log ni en un mensaje de error, solo el
   estado HTTP o un código cerrado.
7. **Atribución.** Igual que Jooble: la oferta lleva el link que devuelve la API (el de seguimiento de Careerjet) y
   «vía Careerjet» en pantalla es condición para prenderla (mismo cambio chico de `attributionFor`).

### `source_kind = other` compartido con Jooble (sin migración)
Careerjet también usa `other`. El intervalo mínimo y el historial de corridas se calculan por `source_kind`, así
que **Jooble y Careerjet comparten historial**: nunca consultan de más, pero una puede dejar sin correr a la otra
durante las 5 horas siguientes. **No se prenden las dos a la vez** hasta que una tenga su propio valor del enum
(con su migración). `source.name` (`Jooble` o `Careerjet`) y el prefijo del `external_id` (`jooble:` o
`careerjet:`) las distinguen en los avisos.

### A verificar al registrarse en Careerjet
Endpoint y versión de la API (el adaptador usa la `search` pública con el afiliado en la query; si la cuenta recibe
otra versión, cambian la autenticación y los nombres de los campos), nombres y tipos de los campos
(`title`, `company`, `locations`, `description`, `salary`, `site`, `date`, `url`), formato de `date` (hoy RFC 822,
con zona), tamaño de página, si hay tope diario o por hora, si el `url` es siempre un link de seguimiento, si se
permite guardar los avisos (retención de 30 días del pool), si exigen atribución con logo y si la ubicación
«Argentina» como texto alcanza o hay que pasar una más precisa.

### Qué falta para prenderla
Todo lo del BLOQUEO; `CAREERJET_AFFID`, `CAREERJET_CALLER_IP` y `SITE_URL` cargadas; «vía Careerjet» en pantalla;
no tener Jooble prendida; un `--dry-run` con datos reales. Está cableada en `fetch.ts` (nombre, kind, intervalo,
tope de tiempo y downloader) y fuera de `POOL_RECOMMENDED_SOURCES`.

## Consequences
- Si la API cumple lo documentado, el pool gana avisos locales en español con link al original, sin
  cuentas en portales ni lectura de emails.
- Una consulta devuelve pocos avisos y el tope diario es chico: el volumen es acotado y no reemplaza a
  un acuerdo de feed. Se mide con el `--dry-run` y se revisa a los 60 días de prendida.
- Al ser un agregador, el mismo aviso puede llegar también por otra fuente: el dedup del pool
  (ADR-014 §3) lo cubre por URL, hash y texto; los avisos sin descripción solo por URL.
- **Riesgo residual:** que las condiciones de la API restrinjan el uso (retención, atribución, uso en
  un producto con cuentas). Se mitiga con la verificación al registrarse, el interruptor y la ausencia
  de presencia pública. No es asesoramiento legal.
