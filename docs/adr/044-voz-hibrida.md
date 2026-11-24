# ADR-044: Voz híbrida: navegador o Gemini en el servidor

**Status:** Proposed · **Date:** 2026-11-23 · **Relacionada:** ADR-001, ADR-002, ADR-004, ADR-034, ADR-038 · **Excepción a:** «Claude principal» del ruteo de modelos

## Context
- «Dictar» solo usaba la Web Speech API. En Opera, Opera GX y Brave el objeto `webkitSpeechRecognition` existe pero sin el servicio de Google detrás: falla en silencio, sin pedir permiso ni mostrar nada. Firefox directamente no la tiene.
- Tampoco había señal visual de que se estuviera grabando.
- **Causa raíz encontrada en la R25-00:** la cabecera `Permissions-Policy` de todas las respuestas llevaba `microphone=()`, que bloquea `getUserMedia` en la página propia sin mostrar el cartel de permiso. Se corrigió a `microphone=(self)`. Sin eso, ningún camino que pida el micrófono podía funcionar, y menos el de grabar.
- Claude no recibe audio: la transcripción no puede ir por el modelo principal que usa el resto de las tareas.

## Decision
1. **El camino lo elige el navegador** (`chooseVoicePath`, puro, en `packages/pipeline/src/voice/path.ts`):
   - Chrome, Edge y Safari siguen con el dictado del navegador: gratis y con texto en vivo.
   - Opera, Opera GX, Brave y Firefox graban con `MediaRecorder` y transcriben en el servidor. La lista sale del user agent y también del comportamiento (errores `network`, `service-not-allowed`, `not-allowed` o 4 s sin resultado con señal de audio).
2. **Siempre `getUserMedia({ audio: true })` primero**: fuerza el cartel de permiso en todos los navegadores y da el stream para la barra de nivel.
3. **Sin perder lo hablado:** la grabación arranca desde el principio, en paralelo al dictado del navegador; si este falla, ya está el audio. Formatos: `audio/webm;codecs=opus`, `audio/ogg`, `audio/mp4`, el primero soportado. Corte a los 2 minutos con aviso a los 1:45.
4. **Transcripción en el servidor** (`POST /api/transcribe`, runtime Node): tarea `transcribe_audio` con **`gemini-3.5-flash` como principal y sin respaldo**. Es la excepción a «Claude principal»: Claude no recibe audio, y un respaldo de otro proveedor sin audio no serviría. Va en `model_routing` (fila nueva, `thinking_level` `minimal`) y en el prompt versionado `transcribe_audio@v1`: literal, en español rioplatense, sin resumir ni corregir, texto plano, y el audio es dato, no instrucción.
5. **El audio no se guarda:** vive solo en memoria durante el pedido (cuerpo leído con tope de bytes, nunca a disco, base ni log) y se descarta. A `llm_calls` va la duración y el costo; el texto transcripto no se loguea. Lo que se guarda es lo que la persona decide enviar después, por el flujo de cada pantalla. El texto transcripto es una propuesta: cae en el campo para corregirlo, nunca se envía solo.
6. **Entrada acotada:** un solo archivo de tipo webm, ogg o mp4 (con la firma de bytes verificada), 2 MB, 120 s declarados (1,5 s de tolerancia de reloj) y como máximo 32 kB por segundo declarado, para que declarar menos segundos no sirva para colar más audio por el mismo cupo.
7. **Cupo:** 20 minutos de audio por persona por día (`VOICE_DAILY_MINUTES`, ventana móvil de 24 h), más el tope global y por persona de gasto en USD. Se reserva antes de llamar (con el lock global del gasto, como la versión del CV adaptada), se cuenta con lo que respondió y se libera si el modelo falla. Los segundos viajan en la etiqueta `voice:<segundos>:<id>` de `llm_calls` (la lleva la reserva viva y la fila real, y cada etiqueta cuenta una vez): **no hay migración ni tabla nueva**. Entra al inventario de topes de `docs/beta/costos.md` (filas 85 y 86).
8. **Canal de archivos del cliente LLM:** el audio viaja como parte `file` por el mismo campo `images` del cliente (`GenerateContext.images`), que ya manda archivos con su `mediaType` al proveedor y no los registra. Se reusó para no tocar `client.ts` ni `types.ts`; el nombre es engañoso y queda anotado como deuda menor.
9. **Interruptor `VOICE_SERVER_TRANSCRIBE=off|testers|all`, apagado por defecto** (`voiceServerMode`; valor ausente o inválido es `off`). `testers` usa `ADMIN_EMAILS` y `ASSISTANT_TESTER_EMAILS`. Con el interruptor apagado, los navegadores que necesitan grabar muestran un mensaje claro en lugar del botón roto, y la ruta responde 403 `off`. Se prende primero en `testers`.
10. **Fake de demo** (`LLM_DEMO=1`): texto fijo según la duración, `model = fake`, costo 0. Todos los tests de la tanda corren sin llamar a ningún modelo.

## Alternativas descartadas
- **Todo por el servidor:** cobra y envía audio a un tercero incluso en Chrome, Edge y Safari, donde el dictado es gratis, en vivo y no pasa por nosotros.
- **Whisper u otro servicio de transcripción:** suma un proveedor, una clave y una política más, para un volumen chico. Gemini ya está contratado y ya está en el ruteo.
- **Transcribir en el navegador** (modelo en WASM): descarga de decenas de MB, lento en el celular y difícil de mantener.
- **Claude con respaldo Gemini**, como el resto de las tareas: Claude no recibe audio, así que el principal nunca podría responder.
- **Guardar el audio** para reintentar o auditar: más datos personales (la voz) sin necesidad; si falla, la persona vuelve a grabar o escribe.
- **Tabla nueva para el cupo:** una migración con RLS para algo que `llm_calls` ya resuelve con la etiqueta.

## Consequences
- La tarea `transcribe_audio` no tiene respaldo: si Gemini falla, la ruta responde 503 `model` y la persona escribe. Es el costo de la excepción.
- Hay que cargar la fila en `model_routing` de producción (SQL con ensayo en los pasos manuales de la R25); sin ella la ruta falla cerrado.
- **Privacidad:** con el modo servidor, el audio sale hacia Google para transcribirse. Hay que reflejarlo en la política de privacidad antes de prender el interruptor para más personas que los testers (texto propuesto en los pasos manuales).
- Riesgos:
  - **Deprecación del modelo:** `gemini-3.5-flash` puede cambiar o retirarse; el ruteo está en la base, pero hay que revisar que el reemplazo acepte audio y ajustar `model-capabilities.ts`.
  - **Precisión:** una transcripción puede equivocarse (nombres propios, siglas, acento). Por eso el texto cae en el campo para corregirlo y nada se envía solo.
  - **Prompt injection por voz:** lo que se dice es dato; el prompt lo prohíbe y un test comprueba con el fake que una orden dicha en voz alta se transcribe literal. La salida del modelo sigue sin disparar ninguna acción.
  - **Costo:** acotado por el cupo diario, el tope por grabación y los topes de USD; reserva calculada contra el peor caso del seed (un test las ata).
  - **Falsos positivos de la lista de navegadores:** se cubren con el criterio por comportamiento, que pasa a grabación sin perder lo hablado.
- No es asesoramiento legal.
