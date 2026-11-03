# Ensayo del 23 y 24/11: un recorrido por carrera (C8-13)

Ensayo interno (Mauro, Ani y quien ayude) **antes de abrir la beta el jueves 26/11**, con la marca AfinIAJobs y las pantallas nuevas de C7 y C8. Complementa la guía para testers (`docs/beta/ensayo-testers.md`, del 20 al 24/11): esa la siguen las personas que prueban; esta la sigue quien organiza, carrera por carrera, y termina en un «sí» o «no» para el 26/11.

El e2e `110-ensayo-beta.spec.ts` hace lo mismo con una persona ficticia por carrera (invitación, registro, onboarding, ofertas evaluadas, detalle, CV y «Contanos qué pasó», a 390 px, en claro y oscuro): si está verde en el CI, lo que queda es mirar con ojos de persona.

## Antes de empezar (Mauro, el 22/11)

- [ ] La integración de C8 mergeada, con `pnpm db:migrate` aplicado (0057 y las policies de `rls/`).
- [ ] Variables en Vercel (producción) y redeploy:
  - `START_HERE_ENABLED=1` («Empezá acá» en `/hoy`);
  - `HELP_TIPS_ENABLED=1` («¿Qué es esto?»);
  - `WELCOME_EMAIL_ENABLED=1` (bienvenida al activar el plan; con `RESEND_API_KEY` y `EMAIL_FROM`);
  - `ACCESO_FUNNEL_ENABLED=1` (embudo de `/acceso`);
  - las de `docs/beta/capacidad.md` §6 (`LLM_DAILY_CAP_USD=4`, `PRICING_ENABLED=1`, `MP_LINK_LISTA`).
- [ ] `/settings/salud` en verde a la mañana del 23.
- [ ] Una invitación por carrera desde `/settings/invitations` (emails de prueba propios, nunca de otra persona).
- [ ] Dos celulares (uno con datos móviles) y una PC. Uno en claro y otro en oscuro.

## El recorrido (unos 25 minutos por carrera)

Hacelo con una cuenta de prueba por carrera. Para las ofertas, usá los avisos inventados de `packages/pipeline/test/fixtures/carreras/<carrera>.json` (pegá el `jd_text` en «Pegar una oferta»): ya sabemos qué debería pasar con cada uno.

| # | Paso | Qué hacer | Qué tiene que pasar |
| --- | --- | --- | --- |
| 1 | Invitación | Abrí el link de la invitación en el celular | Abre el registro con la marca; la carrera viene elegida si salió de la lista de espera |
| 2 | Registro | Email, contraseña y aceptar los términos | Entra al onboarding; nada en inglés ni con jerga |
| 3 | Onboarding | Perfil, lo que sabés hacer (paso 2) y primeras ofertas | Tres pasos, se entiende qué pide cada uno |
| 4 | Activar el plan | Desde la cuenta admin, «Pagó» en `/settings/planes` | Llega **un** email de bienvenida (no dos si tocás dos veces) |
| 5 | Hoy | Entrá a `/hoy` | «Empezá acá» con el perfil hecho y el resto pendiente; se puede cerrar |
| 6 | Pegar una oferta | El caso `nueve_mas` de la carrera | En minutos aparece con puntaje alto; «A tu favor» tiene sentido |
| 7 | Ofertas que no van | Los casos `senior_inalcanzable` y `titulo_enganoso` | Si llegan, puntaje bajo y el motivo dicho en llano |
| 8 | Detalle | Abrí una oferta evaluada | Puntaje, «A tu favor / Te falta», «¿Qué es esto?» se abre y se entiende |
| 9 | Sin descripción | Si llegó alguna por email, completala | Los 3 pasos se entienden; la ayuda explica por qué falta |
| 10 | CV | `/cv` (y `/cv/armar` si está prendido) | Se arma con lo cargado; nada inventado |
| 11 | Áreas | Ajustes → «Tus puestos» | Las áreas de la carrera aparecen y la ayuda dice que hoy no esconden ofertas |
| 12 | Contanos qué pasó | Mandá un comentario | «¡Gracias!»; aparece en `/settings/metricas` sin el email |
| 13 | Oscuro | Repetí 5, 8 y 10 en el otro celular | Todo se lee; nada blanco sobre blanco |

## Qué anotar

Para cada carrera y cada paso: **funcionó / funcionó raro / no funcionó**, una captura si algo se ve mal y **la frase exacta** que confundió. Prioridades:

- **Bloqueante:** no deja avanzar, muestra datos de otra persona, cobra o promete algo que no es, o el texto legal no coincide con lo que se cobra (ver `docs/legal/preguntas-ani.md`, pregunta 5).
- **Importante:** se entiende mal, el puntaje no tiene sentido para la carrera, falta un aviso de su carrera que debería estar.
- **Menor:** detalles de texto, alineación, un ícono.

## Plantilla de reporte (copiar una por carrera)

```
Carrera:
Quién probó:            Fecha y hora:
Celular / navegador:    Tema: claro / oscuro

Paso | Resultado (ok / raro / no) | Nota o frase exacta | Captura
1 Invitación    |  |  |
2 Registro      |  |  |
3 Onboarding    |  |  |
4 Plan y email  |  |  |
5 Hoy           |  |  |
6 Pegar oferta  |  |  |
7 Las que no van|  |  |
8 Detalle       |  |  |
9 Sin descripción |  |  |
10 CV           |  |  |
11 Áreas        |  |  |
12 Contanos     |  |  |
13 Oscuro       |  |  |

Bloqueantes:
Importantes:
Menores:
¿La abrirías el 26/11 para esta carrera? sí / no / sí con cambios:
```

## Decisión del 24/11 a la noche

- **Se abre** si no queda ningún bloqueante abierto y `/settings/salud` está en verde.
- **Se abre sin una carrera** si sus bloqueantes son de esa carrera (por ejemplo, el pool no trae ofertas): se avisa a quienes la eligieron.
- **Se posterga** si hay un bloqueante de cuentas, de cobro o legal.

Los bloqueantes van como issue con la etiqueta de la carrera; los importantes, a un PR chico cada uno.
