# Informe de la tanda R26 «Revisión de Ani y pulido para la beta» (24/11)

Ani ya puede revisar desde la app, sin deploy:
- aprueba o pide cambios en las fichas de Academy;
- aprueba o propone otro texto para los textos del rediseño;
- recorre las pantallas con una guía;
- deja comentarios atados a cada pantalla.

Además, el celular deja de tapar contenido y el coach del CV pesa unos 30 kB menos.

Ningún agente llamó a un modelo (USD 0), tocó Neon, Vercel o Resend, ni mergeó nada. Hay tres migraciones y dos RLS sin aplicar: ver [`pasos-manuales-r26.md`](pasos-manuales-r26.md).

## Cómo están armadas las ramas

Una sola cadena sobre `ronda/admin-panel` (PR #561), que ya trae la R23, la R24 y la R25. Alcanza con integrar `ronda/r26-cierre`.

Algunos tickets comparten muchos archivos y van juntos en una rama:
- R26-01 y R26-02 comparten la regla de publicación, las migraciones y los helpers.
- R26-03 y R26-04 comparten el widget de feedback.

R26-03 va después de R26-05, porque «Abrir» del primer uso resetea la marca de la cuenta.

| # | Rama | Tickets |
|---|---|---|
| 1 | `ronda/r26-01-aprobacion` | R26-01, R26-02 |
| 2 | `ronda/r26-05-celular` | R26-05 |
| 3 | `ronda/r26-03-recorrido` | R26-03, R26-04 |
| 4 | `ronda/r26-06-rendimiento` | R26-06 |
| 5 | `ronda/r26-07-qa` | R26-07 |
| 6 | `ronda/r26-cierre` | Backlog, este informe y los pasos manuales |

Las ramas intermedias no se compilaron una por una. El typecheck, los unitarios y el build se corrieron sobre el árbol completo: integrar siempre hasta el cierre.

## Por ticket

- **R26-01 · Academy desde la app.**
  - Tabla `academy_reviews` (0079, RLS 0065). Solo se agregan filas: el estado vigente es la más nueva.
  - Una ficha se publica si su archivo dice `aprobada` **o** si la base tiene una aprobación con la **misma huella**: sha256 del contenido sin la línea `estado`.
  - Si el contenido cambia, la aprobación vieja no vale y la ficha vuelve a borrador. La regla es pura, en `pipeline/publicacion.ts`, con tests primero.
  - En `/settings/academy`: «Aprobar», «Pedir cambios» con comentario obligatorio, y el historial.
  - `/academy`, el detalle y los «?» leen lo publicado. Si la consulta falla, mandan los archivos.
- **R26-02 · Textos del rediseño.**
  - Tabla `text_reviews` (0080, RLS 0066). Cada texto de `textos-rediseno.ts` (unos 80) tiene «Aprobar» y «Proponer otro», con la misma regla de huella.
  - **La propuesta no cambia la app**: aparece en `/admin/textos`, en «Propuestas de Ani», con «Copiar».
  - Hay una vista para testers en `/settings/textos`.
  - La checklist de apertura cuenta los textos y las fichas aprobados desde la base. Es el pendiente «marca de aprobado» de la R22.
- **R26-03 · `/recorrido`.**
  - Solo admins y testers (404 al resto; el middleware exige sesión).
  - 18 pantallas en 9 grupos, como el menú. Cada una tiene:
    - una línea de qué es;
    - tres cosas para mirar;
    - «Abrir», que resuelve en el servidor la primera oferta o simulación de quien revisa;
    - «Comentar esta pantalla».
  - Progreso «Revisaste N de M» en el navegador.
  - Links en Ajustes y en «Más», solo para quien puede verlo.
- **R26-04 · Feedback por pantalla.**
  - La ruta se normaliza contra el árbol real de `app/` (`/jobs/[id]`, `/academy/[slug]`) al guardar y al leer, así los comentarios viejos caen en su pantalla.
  - Campo opcional «¿Qué te gustaría que cambie?».
  - `/admin/feedback` agrupado por pantalla, con conteo y filtros.
- **R26-05 · Celular.**
  - En el celular la mascota del asistente se esconde mientras se escribe (el contador de Interview queda a la vista).
  - El aviso «Preguntame lo que quieras» sale una vez por navegador y más chico.
  - Más aire al final de la página.
  - Banner de vencimiento con margen en `/hoy`.
  - Primer uso guardado en la cuenta (`profiles.primer_uso_visto`, 0081), leído en la misma consulta del avatar.
- **R26-06 · Rendimiento.**
  - El coach sin Framer, con una animación CSS.
  - El onboarding sin zod ni el catálogo de áreas en el cliente: las áreas se arman en el servidor.
- **R26-07 · QA.**
  - `ensureSeedPerson` hace que los e2e viejos que dependían del usuario del seed corran en una base local sin seed.
  - e2e 240: axe del panel y de `/recorrido`.
  - e2e 244: Academy con una ficha aprobada, con fichas de prueba en `ACADEMY_DIR`, que solo vale en local.

## Decisiones del lead y del equipo

- **Quién aprueba en la base:** una fila en `app_admins` o el rol `tester` en `user_roles`. Un tester solo por variable de entorno ve las pantallas, pero no puede aprobar. A Ani hay que darle el rol desde `/admin/personas`.
- **Aprobada por archivo manda:** si el archivo dice `aprobada`, la pantalla no ofrece «Pedir cambios», porque no la despublicaría.
- **Una propuesta sobre un texto aprobado lo saca de «aprobados»:** el último dicho manda. Cambiarlo es una línea en `estadoDeTexto`.
- **La sugerencia del feedback va al final del mensaje** y no en `context`. Así no hubo que tocar la función SQL de lectura del admin ni sumar otra RLS.
- **«Achicar la burbuja»:** el aviso sale una sola vez y más chico. El botón ya mide 44 px, el mínimo táctil.
- **Primer uso en una columna de `profiles`**, sin tabla nueva: la RLS de `profiles` ya la cubre.

## Rendimiento (First Load, `next build` sobre el árbol completo)

| Ruta | Antes | Después |
|---|---|---|
| `/cv/coach` | ~174 kB | 145 kB |
| `/cv/coach/charla` | 177 kB | 148 kB |
| `/cv/coach/listo` | 149 kB | 149 kB |
| `/onboarding` | 160 kB | 153 kB (*) |
| `/onboarding/cv` | 154 kB | 154 kB |
| `/recorrido` (nueva) | — | 116 kB |
| `/admin/textos` | — | 111 kB |

(*) Medido con la primera pasada. La segunda, que saca la última importación con zod, quedó **sin medir**; se esperan unos 125–130 kB. `/onboarding/cv` sigue con zod por el flujo del agente de perfil.

## Pruebas

- Typecheck: 6 de 6 paquetes. Unitarios: pipeline 6229 y web 441.
- Integración contra Postgres (equipo): `multiusuario` y `admin-personas`, 298 tests. Casos nuevos:
  - una persona común no escribe ni lee el historial;
  - un tester aprueba;
  - con una huella nueva la ficha vuelve a borrador;
  - una propuesta no aprueba.
- Las migraciones 0079 a 0081 y las RLS 0065 y 0066 se aplicaron en Docker local.
- **e2e a medio correr.** La corrida se cortó porque la máquina se quedó sin memoria, y no se relanzó en la tanda. Resultados visibles:
  - pasaron 38 (8 casos), 237, 238, 241 (salvo el caso del banner, que necesita `PRICING_ENABLED=1`) y 243;
  - 244 falló por timeout: se corrigió en seco (abrir el «?» antes de buscar el enlace), sin volver a correrlo;
  - 239 y 240 se saltearon por falta de admin en el entorno;
  - del resto no quedó resultado.
- La lista para correr está en los pasos manuales §5.
- **Sin capturas:** las de `/recorrido`, `/settings/academy`, `/admin/textos` y el antes y después del celular quedan para esa misma corrida.

## Carril

Rojo:
- las migraciones y las RLS;
- `layout.tsx`, `route-access.ts`, `apertura.ts`, `feedback-triage.ts`;
- los archivos nuevos que deciden quién revisa: `academy-revisiones.ts`, `textos-revisiones.ts`, `recorrido-access.ts`, `settings/academy/actions.ts`, `settings/textos/**`, `recorrido/page.tsx`. Se sumaron a `.github/carril-rojo.txt` y a `CODEOWNERS`.

No hay prompts nuevos: el PR no dispara evals pagos.
