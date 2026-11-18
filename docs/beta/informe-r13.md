# Informe de la tanda R13 «Antes de la beta» (18/11, noche)

Trabajaron cuatro teammates y el lead. Todas las ramas salen de `origin/main` en `0ef91b9` (con #534). **Ningún PR se mergeó y ningún PR está abierto todavía:** las ramas están pusheadas y los textos de cada PR quedaron listos (ver §4, paso 1).

## 1. Aviso temprano

**R13-1, R13-2 y R13-3 están listas para integrar.** Son las urgentes para la beta. Se mezclan en el orden de la tabla: R13-3 va antes que R13-2.

## 2. Ramas, en el orden de merge sugerido

| Orden | Rama | Ticket | Carril | Antes de mergear |
|---|---|---|---|---|
| 1 | `ronda/r13-1-confirmacion-gmail` | R13-1 · asunto nuevo de la confirmación de reenvío de Gmail | rojo | — |
| 2 | `ronda/r13-3-ruteo-cola-manual` | R13-3 · ZonaJobs a la cola manual con el cuerpo guardado | rojo | — |
| 3 | `ronda/r13-2-filtro-bumeran` | R13-2 · Bumeran y ZonaJobs en el filtro de Gmail | verde | Después de R13-3 |
| 4 | `ronda/r13-5-detalles-r12` | R13-5 · detalles abiertos de la R12 | verde | Borrar `upload-card.tsx` (§4) |
| 5 | `ronda/r13-6-reservas-bajo-lock` | R13-6 · soltar las reservas bajo el lock de la persona | verde | — |
| 6 | `ronda/r13-8-jooble` | R13-8 · Jooble, adaptador apagado | verde | — |
| 7 | `ronda/r13-9-doc-rol-app` | R13-9 · el rol `jobsearch_app` en los tests | verde | — |
| 8 | `ronda/r13-4-e2e-135` | R13-4 · e2e 135 sin `fixme` y con etapas | a mano | **Solo con el job `e2e` en verde** |
| 9 | `ronda/r13-cierre` | Este informe y el Bloque 27 | verde | Al final |

**R13-7 no tiene rama.** Editar `.github/**` necesita una aprobación que de noche nadie podía dar, así que quedó como propuesta para aplicar a mano (§4, paso 6).

## 3. Qué se probó y qué no

**La mezcla completa no se probó.** El guard del equipo bloquea `git merge`, así que no hay corrida de lint, typecheck, unit ni integración sobre las ramas juntas. Lo que sí se comprobó:

- Las ocho ramas de código y documentación **no comparten ningún archivo** (comparación de `git diff --name-only` contra la base). No debería haber conflictos de texto entre ellas.
- Cada rama pasó por separado sus tests unitarios, typecheck, lint y prettier sobre lo que tocó. Los 3 tests de symlinks de `privacy-scan.test.ts` fallan en Windows y son un fallo conocido.
- Integración con Testcontainers por rama: R13-1 (bandeja), R13-3 (suite de `adapters`), R13-6 (`cv-chat`, `profile-agent` y `cv-coach`) y R13-8 (`fetch`).

**Los e2e no se corrieron.** El guard bloquea Playwright en local, y el job `e2e` del CI solo corre en PRs hacia `main`.

## 4. Pasos manuales para el dueño del proyecto

1. **Destrabar los PR.** Hacen falta las dos cosas, en la carpeta principal:
   - Borrar la copia suelta: `rm docs/beta/carga-sin-streaming.md`. `main` ya trackea ese archivo, así que `git switch` falla.
   - Sacar del repo la carpeta sin trackear `Claude outputs/`. El script que abre los PR barre también lo que no está trackeado, y esa carpeta tiene hallazgos de privacidad.
2. **Instalar dependencias** en la carpeta principal: `pnpm install`.
3. **R13-1, después del deploy.** Ver a quién avisar, con esta consulta de solo lectura:
   ```sql
   SELECT ie.user_id, u.email, count(*) AS mails, max(ie.received_at) AS ultimo
   FROM inbound_emails ie
   LEFT JOIN users u ON u.id = ie.user_id
   WHERE ie.from_address ILIKE '%forwarding-noreply@google.com%'
     AND ie.error ILIKE 'remitente no esperado%'
     AND ie.received_at >= now() - interval '7 days'
   GROUP BY ie.user_id, u.email
   ORDER BY ultimo DESC;
   ```
   Cada persona de la lista entra a Gmail y usa **«Reenviar el correo de verificación»**.
4. **R13-2.** Quien ya importó el filtro de Gmail lo vuelve a descargar e importar.
5. **R13-5.** Borrar el componente sin uso: `git rm apps/web/components/profile-agent/upload-card.tsx`.
6. **R13-7.** Aplicar la propuesta del `ci.yml` si se la quiere. Hoy el job `e2e` tarda 24 min de mediana (11 corridas medidas). Con tres jobs se estiman 10 a 13 min: es una estimación, porque el workflow no se ejecutó.
7. **R13-8.** Para prender Jooble: registrarse en la API para editores, cargar `JOOBLE_API_KEY` y sumar `jooble` a `POOL_SOURCES`. Antes hay que resolver «vía Jooble» en pantalla (§5).

## 5. Qué quedó abierto

- **R13-4: la causa del cuelgue del e2e 135 no está demostrada.** El spec salió sin `fixme` y con etapas de tiempo propio: la primera corrida del CI dice en qué etapa se traba. Hasta entonces, el agente de perfil se prueba a mano.
- **R13-1: no se probó con un mail real.** Los mails del 17/11 se guardaron sin cuerpo, así que las señales del cuerpo se probaron con textos inventados.
- **R13-3:** el camino completo se probó con un dominio ficticio marcado como fuente de empleo, no con el remitente real de ZonaJobs.
- **R13-5:** los proyectos ahora llegan al resumen del CV como proyectos, y eso no se midió con el modelo real. Hay que mirar el resumen en la prueba a mano.
- **R13-8:** el detalle de la oferta muestra el nombre «Jooble» y el link al original, pero todavía no dice «vía Jooble». Es condición para prender la fuente. Nada se probó contra la API real, y el link de registro está por confirmar.
- **R13-8:** Jooble usa `source_kind = other`. Si otra fuente del pool usa ese valor, hace falta un valor propio con migración.

## 6. Gasto de evals

USD 0. Ninguna rama toca `packages/prompts/**` ni `evals/**`.
