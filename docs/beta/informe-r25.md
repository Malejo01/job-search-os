# Informe de la tanda R25 «Voz en todos los navegadores» (23/11)

«Dictar» no pedía permiso ni hacía nada en Opera GX, Brave y Firefox. La causa principal era nuestra: la cabecera `Permissions-Policy` llevaba `microphone=()`, que bloquea el micrófono en todos los navegadores sin mostrar el cartel. Se arregló y, además, la voz ahora es híbrida ([ADR-044](../adr/044-voz-hibrida.md)):
- Chrome, Edge y Safari dictan con el navegador, gratis y con texto en vivo.
- Opera, Brave y Firefox graban y transcriben en el servidor con Gemini, detrás de un interruptor **apagado por defecto**.

Ningún agente llamó a un modelo (USD 0: todo con el fake de transcripción), tocó Neon, Vercel o Resend, ni mergeó nada. Sin migraciones ni RLS.

## Cómo están armadas las ramas

Una sola cadena sobre `ronda/r24-cierre`, porque la R25 toca archivos que cambiaron la R23 y la R24 (`dictar.tsx` y el simulador de Interview). Alcanza con `ronda/r25-cierre`. **Antes van la R23 (#558) y la R24.**

| # | Rama | Qué hace |
|---|---|---|
| 1 | `ronda/r25-00-microfono-propio` | `microphone=(self)`: la causa raíz |
| 2 | `ronda/r25-01-motor-voz` | Motor que elige el camino y no pierde lo hablado |
| 3 | `ronda/r25-03-ruta-transcribe` | `POST /api/transcribe`, cupo, ruteo y prompt |
| 4 | `ronda/r25-02-voice-input` | Componente `VoiceInput` |
| 5 | `ronda/r25-05-voz-en-chats` | Voz en los cuatro chats |
| 6 | `ronda/r25-04-tests-transcribe` | Tests de la ruta y del cupo contra la base |
| 7 | `ronda/r25-06-e2e-voz` | e2e 220–229 y `docs/beta/voz.md` |
| 8 | `ronda/r25-07-voz-lazy-y-senal` | Carga diferida, anuncios de estado y pico retenido |
| 9 | `ronda/r25-cierre` | Backlog, ADR-044, este informe y los pasos manuales |

La rama 7 tiene e2e que recién pasan con la 8 (el anuncio de «Escuchando»). Integrar siempre hasta el cierre.

## Por ticket

- **R25-00 · El micrófono.**
  - `security-headers.ts` pasó de `microphone=()` a `microphone=(self)`: solo las páginas propias pueden pedir el micrófono, con el permiso del navegador. Iframes y terceros siguen sin acceso; cámara, ubicación, pagos y USB siguen cerrados.
  - Lo encontró el teammate del servidor leyendo las cabeceras.
  - Con el deploy, Chrome, Edge y Safari ya dictan, aunque el interruptor siga apagado.
- **R25-01 · Motor.**
  - `chooseVoicePath` (puro) decide por user agent y por comportamiento. Si el reconocimiento tira `network`, `service-not-allowed` o `not-allowed`, o pasan 4 s sin resultado con voz, pasa a grabar.
  - `getUserMedia` siempre va primero, así el cartel de permiso aparece en todos los navegadores.
  - La grabación arranca desde el principio sobre el mismo stream, así no se pierde lo hablado.
  - Formatos webm/opus, ogg y mp4; aviso a 1:45 y corte a 2:00.
  - Mensajes de error con instrucciones por navegador.
- **R25-02 · `VoiceInput`.**
  - Barra de 5 a 7 niveles en índigo y punto rojo con «Escuchando…» y contador.
  - «Listo» en lima y «Cancelar».
  - Vista previa con parciales en gris y finales en el color del texto; «Transcribiendo…» con skeleton.
  - Accesibilidad: `aria-pressed`, región `aria-live` que dice el estado en todo momento y 44 px.
  - Con movimiento reducido, un número de nivel.
  - Muestra el aviso de privacidad según el camino.
- **R25-03 · Ruta.**
  - Sesión, interruptor, origen y términos.
  - El cuerpo se lee con tope de bytes antes de parsear. Un solo archivo con firma verificada, 2 MB, 120 s declarados y un control de bytes por segundo.
  - Cupo de 20 min por persona y día, reservado antes de llamar y liberado si falla; los segundos van en la etiqueta de `llm_calls`, sin tabla nueva.
  - `transcribe_audio` usa `gemini-3.5-flash` sin respaldo, porque Claude no recibe audio.
  - El audio solo vive en memoria y el texto no se loguea.
- **R25-04 · Tests.**
  - Ruta (20): incluye que el texto no aparezca en los logs y que «ignorá las instrucciones» se transcriba literal.
  - Cupo contra Postgres (16).
  - SQL de producción con ensayo.
- **R25-05 · Los cuatro chats.**
  - Interview, el coach, «Armá tu CV con IA» y los huecos del perfil (en Ajustes y en el onboarding).
  - Lo dictado se suma con `joinDictated`, se recorta al máximo del campo y nunca se envía solo. En «Qué hacías» entra como línea nueva.
- **R25-06 · e2e.**
  - 220–229 con el micrófono falso de Chromium: permiso, barra, texto en vivo, modo servidor, «Cancelar», tope, interruptor apagado, respaldo a grabación, sin permiso o sin micrófono, los cuatro chats, movimiento reducido y a11y.
  - Tabla de navegadores en [`voz.md`](voz.md).

## Decisiones del lead

- **Base `ronda/r24-cierre` y no `main`.** `main` solo tenía la R21; la R25 toca archivos de la R23 y la R24.
- **Bloque 42 del BACKLOG**, no 40: la R23 y la R24 ya usan el 40 y el 41.
- **Las barras sin Framer.** El prompt lo pedía, pero la R23 y la R24 lo sacaron de esas rutas por unos 30 kB cada una, y las barras se mueven a la frecuencia del analizador. Se usa `requestAnimationFrame` con estilos directos.
- **Pico retenido para detectar la voz.** El e2e 226 mostró que mirar el nivel solo cada 250 ms se pierde la voz entre ticks. En la vida real, una pausa entre palabras podía impedir el respaldo a grabación.
- **Audio por el canal `images` del cliente LLM.** Evita tocar `client.ts` y `types.ts`. El nombre engaña; queda como deuda en el ADR.
- **Sin sesión, `/api/transcribe` no se alcanza:** el middleware redirige a `/login`, como todo `/api/*`. El 401 propio de la ruta está en el test unitario.

## Rendimiento (First Load, `next build`)

| Ruta | Base (R24) | Final |
|---|---|---|
| `/interview/[id]` | 116 kB | 116 kB |
| `/cv/coach/charla` | 178 kB | 177 kB |
| `/cv/armar` | 115 kB | 116 kB |
| `/cv/perfil/huecos` | 144 kB | 146 kB |
| `/onboarding/cv/huecos` | 144 kB | 146 kB |

Sin la carga diferida de `VoiceInput`, esas rutas subían de 4 a 6 kB.

## Pruebas

- Typecheck sin errores. Unitarios: pipeline 6181 y web 394.
- Integración: cupo de voz 16 contra Postgres.
- e2e en local, todos verdes:
  - 220–229 (voz);
  - 152, 187, 180–182 (Interview y dictado);
  - 200 (galería);
  - 210 (accesibilidad);
  - 43 (cabeceras), salvo el caso que usa el usuario del seed.
- **Sin probar en navegadores reales:** los e2e usan Chromium con micrófono falso y un user agent de Opera GX. Falta una prueba a mano en Opera GX, Brave y Firefox (pasos manuales §5).

## Carril

Rojo:
- `security-headers.ts`;
- `app/api/transcribe`;
- `pipeline/src/voice/flag.ts` y `lib/voice/server.ts`, que se sumaron a la lista roja y a `CODEOWNERS`.

El prompt nuevo (`packages/prompts/transcribe_audio.v1.md`) hace que el PR dispare evals en el CI.
