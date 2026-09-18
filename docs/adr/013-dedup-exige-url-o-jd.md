# ADR-013: Dedup — empresa + título ya no fusiona

**Status:** Accepted · **Date:** 2026-09-18 · **Reemplaza:** la clave blanda (punto 2) de ADR-006

## Context
El 2026-09-18 se cargaron a mano dos avisos distintos de la misma consultora, con URLs distintas:
"Senior Quality Engineering (Loyalty & Benefits, Manual/API Testing)" y "Senior Quality
Engineering (Biometric)". `normalizeTitle` quita seniority y paréntesis, así que los dos quedaron
en `quality engineering` (Jaccard 1) y la clave blanda de ADR-006 los fusionó. Como fusionar
conserva "el texto más largo", el JD de Biometric pisó al de Loyalty: el job quedó con título,
prefiltro y URL de uno y descripción y skills del otro. Se recuperó con un snapshot de Neon
dentro de la ventana de 6 h de historial.

Revisando producción apareció un segundo caso: "Founding Senior AI Engineer" y "Senior AI
Engineer" de la misma empresa en Get on Board (dos slugs, requisitos distintos) → Jaccard 0.67,
fusionados.

Las consultoras publican en serie "Senior X Engineer (área)" y el área vive justo en el
paréntesis que la normalización descarta. Empresa + título parecido no identifica un aviso.

## Decision
Solo se fusiona cuando algo identifica al aviso:
1. **Clave fuerte:** misma `canonical_url`, mismo `external_id` de la misma fuente, o **mismo
   `jd_hash`** (sha256 del JD sin mayúsculas ni espacios repetidos) → merge.
2. **Texto:** JD en ambos con similitud de shingles ≥ 0.9 → merge con `volume_recruiting`
   (sin cambios respecto de ADR-006; caso golden 19/20).
3. **Empresa + título** (Jaccard ≥ 0.6, 14 días) **ya no fusiona**. Si no hay JD en alguno de los
   dos, el nuevo se inserta aparte con `jobs.duplicate_of_id` apuntando al parecido y flag
   `posible_duplicado`, para revisarlo a mano. Si los dos tienen JD y el texto no llega a 0.9,
   el texto desmiente al título y no se marca nada.

`normalizeTitle` no cambia: sigue sirviendo para prefiltro y mercado; el problema era usarlo
como identidad.

## Consequences
- Perder datos por una fusión equivocada deja de ser posible por parecido de nombre. El costo
  es el inverso: el mismo aviso visto por dos canales sin JD en común (alerta de LinkedIn sin JD
  + carga desde la web de la empresa) queda como dos jobs, marcado `posible_duplicado`. Es un
  error visible y reversible; la fusión errónea no lo era.
- Test de regresión con los dos casos reales anonimizados en
  `packages/pipeline/src/dedup/fixtures/regressions.json` (originales en `fixtures-private/recovery/`).
- Pendiente fuera de este ADR: mostrar `posible_duplicado` en la UI con fusión manual (JS-025) y guardar el crudo de toda carga para que ninguna fusión pueda perder texto (JS-024).
- **Forma canónica de LinkedIn (intencional, no corregir):** `canonicalUrl` guarda `https://linkedin.com/jobs/view/<id>`, sin `www`, sin subdominio de país y sin barra final. Es a propósito: la clave fuerte por URL compara esa cadena exacta, y así un aviso visto como `www.linkedin.com/jobs/view/<id>/`, `ar.linkedin.com/...`, `/comm/jobs/view/...` o `?currentJobId=<id>` cae en el mismo job. Si se cambiara la forma, los jobs ya guardados dejarían de coincidir con los nuevos y se duplicarían (confirmado con tráfico real el 2026-09-18: Empresa S (golden id 24) y la alerta de LinkedIn se cruzaron por URL).

## Incidente del 2026-09-18: cierre completo

Caso de estudio del incidente que originó este ADR. Horas en UTC. Empresas con el alias del mapa
de anonimización (`fixtures-private/empresas.map.json`): **Empresa E** es la consultora de QA
(golden id 5) y **Empresa N** es la del caso de Get on Board (el mismo alias que usa la fixture de
regresión).

### Resumen en un minuto

Dos avisos distintos de la misma consultora se fusionaron en un solo job porque el dedup los
identificaba por empresa + título normalizado, y la normalización borra justo la parte del título
que los distinguía. La fusión se quedó con el JD más largo y descartó el otro sin dejar copia.
Lo recuperamos de un snapshot de Neon dentro de la ventana de 6 h de historial, cambiamos el
criterio para que solo fusione lo que identifica al aviso (URL, id de la fuente, hash o texto del
JD), agregamos regresiones con los casos reales anonimizados y reparamos producción con
transacciones que se verifican contra la huella del snapshot antes de confirmar. Cero pérdida de
datos, pero por suerte: de ahí sale JS-024.

### Línea de tiempo

| Hora (UTC)  | Hecho                                                                                                                                                                                                                                                                                  |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 02:55:17    | Carga manual de "Senior Quality Engineering (Loyalty & Benefits, Manual/API Testing)", Empresa E. Insert; el prefiltro la descarta por híbrida.                                                                                                                                         |
| 02:55:23    | Carga manual de "Senior Quality Engineering (Biometric)", misma empresa, otra URL. Dedup: empresa igual + Jaccard de título **1.0** → merge. El JD de Biometric (1979 caracteres) reemplaza al de Loyalty (1895) por ser "el más largo", las skills se recalculan desde el JD nuevo y la URL de Biometric queda como segunda fuente. |
| ~03:00      | Mauro detecta que el registro mezcla dos avisos.                                                                                                                                                                                                                                       |
| 03:03       | Snapshot de la rama `main` de Neon en el instante 02:55:20: después del insert, antes del merge. El historial de Neon (PITR) es de 6 h, así que vencía cerca de las 08:55.                                                                                                               |
| 14:41       | Restore del snapshot en una rama **nueva sin finalizar** (con `finalize: true`, Neon le pasa el compute de `main` a la rama restaurada). Lectura del registro previo a la fusión: JD, hash, shingles y skills de Loyalty intactos.                                                      |
| 14:50–15:10 | Auditoría de producción y del golden; fix con tests; PR.                                                                                                                                                                                                                                |
| 15:18       | Reparación de Empresa E en producción (bloques 1–3), verificada dentro de la transacción.                                                                                                                                                                                              |
| 15:34       | Merge del PR con el CI completo en verde (18/18 tests de integración).                                                                                                                                                                                                                  |
| 15:35       | Deploy de producción confirmado en el commit del merge.                                                                                                                                                                                                                                 |
| ~15:36      | Reparación de Empresa N (bloque 4) y recarga de los dos avisos desenganchados. Faltaban 2 h 24 min para el cron de Get on Board de las 18:00.                                                                                                                                           |

### Causa raíz

1. **Normalizar no es identificar.** `normalizeTitle` quita seniority, stopwords y todo lo que va
   entre paréntesis, porque para prefiltro y mercado "Senior AI Engineer (Remote)" y "AI Engineer"
   son el mismo rol. Pero las consultoras publican en serie "Senior X Engineering (área)" y el
   área vive en el paréntesis: los dos avisos quedaban como `quality engineering`, Jaccard 1.
2. **La clave blanda fusionaba sola.** ADR-006 trataba "empresa igual + Jaccard ≥ 0.6 + 14 días"
   como identidad del aviso. No lo es: es parecido.
3. **Fusionar destruía.** La regla "conservar el texto más largo" descartaba el otro JD sin
   guardarlo en ningún lado, y la carga manual no guarda crudo en `raw_blobs`. Un error de
   decisión (1 y 2) se convirtió en pérdida de datos por (3).

### Detección y alcance

- **Producción:** todo job que absorbió una fusión tiene más de una fila en `job_sources`. Eran
  3: Empresa E (errónea); Empresa N (errónea: "Founding Senior AI Engineer" vs "Senior AI
  Engineer", dos slugs de Get on Board con requisitos distintos, Jaccard 0.67); y Empresa S
  (golden id 24, correcta: el mismo id de LinkedIn). En Empresa N el JD que quedó era el correcto
  para el título del registro, y el de "Founding" seguía publicado en Get on Board, así que se
  pudo volver a traer.
- **Golden (34 avisos):** el seed no pasa por dedup, y con el criterio viejo ningún par de la
  misma empresa llegaba a 0.6 (máximo 0.50, par 6/7). Sin impacto.

### Recuperación

- Sin crudo en `raw_blobs` (carga manual) y sin llamadas LLM ni evaluación del job: la única copia
  del JD de Loyalty era el historial de Neon.
- Snapshot en un instante entre los dos commits (insert a las 02:55:17.145, merge a las
  02:55:23.396) → restore en rama aparte, solo lectura. `main` no se tocó en este paso.
- El JD recuperado, sus metadatos y los de Biometric se copiaron fuera de git
  (`fixtures-private/recovery/`) apenas se leyeron, antes de seguir.

### Fix (este ADR)

- Fusionan solo **URL canónica**, **external_id** o **`jd_hash`** (claves fuertes), o **texto del
  JD ≥ 0.9** (sin cambios: es el caso golden 19/20, un mismo aviso con dos títulos).
- Empresa + título parecido **inserta aparte** con `duplicate_of_id` y flag `posible_duplicado`
  cuando falta el JD en alguno de los dos. Si los dos traen JD y el texto no coincide, el texto
  desmiente al título y no se marca.
- Tests primero, en rojo con el bug:
  - `packages/pipeline/src/dedup/fixtures/regressions.json`: los dos casos reales anonimizados
    (empresa y URLs ficticias; el título conserva la forma del original, que es lo que dispara el
    bug) y dos controles: mismo JD con otra URL (merge por `jd_hash`) y alerta sin JD vs carga
    manual (posible duplicado). **Cada caso corre en los dos órdenes de llegada.** Un test fija
    que los dos títulos normalizan igual y aun así no se fusionan.
  - Tres tests de integración contra Postgres real: dos avisos → dos jobs con su JD intacto;
    posible duplicado con `duplicate_of_id`; merge por `jd_hash`.

### Reparación en producción

Principio: nada se corre sin que Mauro revise el SQL completo, y cada transacción **se verifica a
sí misma antes de confirmar**. Si la verificación falla, se aborta entera.

1. **Huella de referencia**, leída en la rama restaurada: `md5(jd_text)`, `md5(jd_shingles::text)`
   y el hash del JD recalculado en SQL con la misma fórmula que la app
   (`sha256(lower(regexp_replace(btrim(jd), '\s+', ' ', 'g')))`), comparado contra el `jd_hash`
   guardado.
2. **Bloques 1–3 (Empresa E)** en una transacción: restaurar JD, hash, shingles y las 4 skills de
   Loyalty, y desenganchar la fuente de Biometric. El `UPDATE` solo toca la fila si todavía tiene
   el hash de Biometric (guarda contra cambios concurrentes). El último paso es un bloque `DO` que
   hace `RAISE EXCEPTION` si no coinciden con la huella el md5 del JD, el md5 de los shingles, el
   `jd_hash` o el hash recalculado; si no hay exactamente 4 skills, o si la fuente de Biometric
   sigue existiendo.
3. **Un error atrapado a tiempo:** el SQL revisado escribía los shingles como `text[]`, pero la
   columna real es `jsonb` (lo reveló la consulta de la huella). Habría fallado por tipo sin tocar
   datos, por ser una transacción, y se corrigió antes de correrlo. Lección: el tipo que importa
   es el de la base, no el que uno asume.
4. **Bloque 4 (Empresa N), recién después del deploy.** El cron de Get on Board corre cada 6 h y
   vuelve a traer el aviso "Founding": desengancharlo con el código viejo en producción habría
   hecho que la próxima corrida lo fusionara otra vez. Se esperó el deploy y se corrió antes del
   cron siguiente, también con verificación dentro de la transacción.
5. **Recarga** de los dos avisos desenganchados por `add_job`, con el código nuevo: entraron como
   inserts, sin fusión y sin marca de posible duplicado. Biometric volvió con el mismo `jd_hash`
   que tenía antes del incidente.

### Estado final verificado (consulta de solo lectura)

| Registro                                            | JD / `jd_hash`                                                        | Fuentes             | Skills                                                                  |
| --------------------------------------------------- | --------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------- |
| Empresa E · Loyalty                                 | 1895 car. · `338dcaff…`, igual al snapshot (md5 de JD y shingles)     | solo su URL         | Java, REST APIs, Salesforce / CRM, Testing automatizado                 |
| Empresa E · Biometric (recargado)                   | 1979 car. · `90772210…`, igual al de antes del incidente              | solo su URL         | Ciberseguridad, IAM / identidad, Microservicios, REST APIs, Testing automatizado |
| Empresa N · Senior AI Engineer                      | 3049 car. · `bea80673…`, sin cambios                                  | solo su slug de GoB | 11, sin cambios (ya evaluado)                                           |
| Empresa N · Founding Senior AI Engineer (recargado) | 1901 car. · `91af1be3…`                                               | su URL de GoB       | propias (agentes, LangChain, Python…)                                   |

- La modalidad de Biometric quedó `desconocida`: el aviso público no la indica (el de Loyalty sí
  dice "Hybrid"), y lo que la fuente no dice no se inventa.
- Rama de recuperación borrada; el snapshot vence solo el 2026-10-02.

### Qué salió bien

- Asegurar la evidencia primero (snapshot a los pocos minutos) y entender después.
- Leer lo recuperado sin tocar `main` (rama nueva sin finalizar).
- Auditar todo el alcance (producción y golden) y no solo el caso reportado: así apareció el
  segundo.
- Tests con los casos reales, en los dos órdenes, en rojo antes del fix.
- Verificación dentro de la transacción contra una huella, no a ojo después.
- Ordenar la reparación contra el deploy y el cron.

### Qué salió mal o fue suerte

- **Suerte:** que el historial de Neon cubriera el momento. Con 6 h, detectarlo a la mañana
  siguiente habría significado perder el JD. → **JS-024**: todo lo que entra guarda su crudo en
  `raw_blobs` antes de procesarse, sea cual sea la vía, y fusionar nunca descarta texto que no
  quede accesible desde su fuente.
- Un parecido de nombre decidía identidad y además destruía datos: dos decisiones de diseño que,
  juntas, no toleraban un error. Ahora el parecido solo marca, y **JS-025** lo va a hacer visible
  en la UI.
- La primera documentación del incidente citó nombres reales de empresas del golden en un commit
  público de `main`. No alcanzó con corregir el archivo: se reescribió ese commit (era la punta de
  `main`, sin forks) con los alias del mapa, se rebaseó el PR abierto encima y se borró la rama del
  PR del fix. Las docs pasan por la misma regla de anonimización que las fixtures.
