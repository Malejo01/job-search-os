# Pasos manuales de la tanda R25

Todo lo de esta lista lo hacés vos: ningún agente toca Neon ni Vercel. Sin migraciones ni RLS.

## 1. El micrófono ya no está bloqueado (sale con el deploy)

La causa de que «Dictar» no pidiera permiso era la cabecera `Permissions-Policy: microphone=()`. Con eso, el navegador niega el micrófono a la página sin mostrar el cartel. Ahora es `microphone=(self)`: solo las páginas propias pueden pedirlo, y siempre con el permiso del navegador. No hay que hacer nada más que desplegar. Después del deploy, Chrome, Edge y Safari ya dictan aunque el interruptor siga apagado.

## 2. Fila `transcribe_audio` en `model_routing` (Neon)

Es un `INSERT` que no pisa ninguna fila (`task` es la clave primaria). Primero corrélo en ensayo, que termina en `ROLLBACK`; después, de verdad.

```sql
BEGIN;

INSERT INTO model_routing (task, provider, model, fallback_model, temperature, max_tokens, thinking_level,
  input_usd_per_mtok, output_usd_per_mtok, fallback_input_usd_per_mtok, fallback_output_usd_per_mtok)
VALUES ('transcribe_audio', 'google', 'gemini-3.5-flash', NULL, 0, 2048, 'minimal', 1.5, 9, NULL, NULL)
ON CONFLICT (task) DO NOTHING;

-- Lo que quedaría
SELECT task, provider, model, fallback_model, temperature, max_tokens, thinking_level,
  input_usd_per_mtok, output_usd_per_mtok FROM model_routing WHERE task = 'transcribe_audio';

-- Guarda: si ya existía una fila distinta, se frena sin tocar nada
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM model_routing
    WHERE task = 'transcribe_audio' AND provider = 'google' AND model = 'gemini-3.5-flash'
      AND fallback_model IS NULL AND temperature = 0 AND max_tokens = 2048
      AND thinking_level = 'minimal' AND input_usd_per_mtok = 1.5 AND output_usd_per_mtok = 9
      AND fallback_input_usd_per_mtok IS NULL AND fallback_output_usd_per_mtok IS NULL
  ) THEN
    RAISE EXCEPTION 'transcribe_audio: la fila no quedó como el seed; mirala antes de pisarla';
  END IF;
END $$;

COMMIT;  -- en el ensayo, ROLLBACK
```

- **Sin respaldo, a propósito:** Claude no recibe audio (ADR-044). Si Gemini falla, la persona ve «Ahora no pudimos transcribir» y puede escribir.
- Sin esta fila, la transcripción en el servidor falla aunque prendas el interruptor.

## 3. Variables (Vercel)

| Variable | Valor | Para qué |
|---|---|---|
| `VOICE_SERVER_TRANSCRIBE` | `testers` primero; `all` recién con la política publicada (§4) | Transcribir en el servidor para Opera, Brave y Firefox. Por defecto `off`: esos navegadores muestran un mensaje en vez del botón |
| `VOICE_DAILY_MINUTES` | opcional, por defecto 20 | Minutos de audio por persona por día |

Con `testers`, la usan solo `ADMIN_EMAILS` y `ASSISTANT_TESTER_EMAILS`.

## 4. Política de privacidad

Con el modo servidor, el audio va a Google (Gemini) para transcribirse y se descarta. Hay que sumarlo a `apps/web/content/legal/privacidad.md` **en la rama del PR legal #552**. El equipo no lo tocó. Texto propuesto (borrador, no es asesoramiento legal):

> **Dictado por voz.** Podés dictar tus respuestas en vez de escribirlas. Lo que pasa con tu voz depende de tu navegador:
>
> - **Con Chrome, Edge o Safari**, el dictado lo hace tu navegador: tu voz la procesa el proveedor de tu navegador (por ejemplo, Google en Chrome o Apple en Safari), según su propia política. AfinIAJobs no recibe tu audio.
> - **Con Opera, Brave, Firefox u otros navegadores sin dictado propio**, grabamos tu voz en tu navegador y, cuando tocás «Listo», enviamos esa grabación a nuestro servidor, que la manda a Google (Gemini) solo para convertirla en texto. **No guardamos el audio**: se procesa en memoria y se descarta apenas termina la transcripción. Esta opción puede estar apagada para tu cuenta; en ese caso te lo avisamos y podés escribir.
>
> El texto que sale del dictado aparece en el campo para que lo revises y lo corrijas. **Solo guardamos el texto que vos decidís enviar**, igual que si lo hubieras escrito; el audio no se guarda en ningún caso. De cada transcripción registramos únicamente su duración y su costo, nunca lo que dijiste. Para cuidar el servicio, cada persona puede transcribir hasta 20 minutos de audio por día. Podés usar la plataforma sin dictar: siempre se puede escribir.

- Si la política tiene una lista de proveedores o encargados, sumá a Google (Gemini) para la transcripción.

## 5. Cómo probar

1. Con el interruptor en `off`, en Chrome: «Dictar» pide permiso, muestra la barra y el texto en vivo; «Listo» deja el texto en el campo, sin enviarlo.
2. En Opera GX, con `off`: en vez del botón aparece el aviso de que no está disponible.
3. Con la fila del §2 y `VOICE_SERVER_TRANSCRIBE=testers`, en Opera GX con tu cuenta: pide permiso, se mueve la barra, «Listo» → «Transcribiendo…» → el texto en el campo.
4. Compatibilidad y cómo dar permiso en cada navegador: [`docs/beta/voz.md`](voz.md).

## 6. Integración

Alcanza con `ronda/r25-cierre`. Sale de `ronda/r24-cierre`: **primero van la R23 (#558) y la R24**. Es carril rojo (`security-headers.ts`, `app/api/transcribe`, `voice/flag.ts`, `voice/server.ts`). El prompt nuevo (`packages/prompts/transcribe_audio.v1.md`) hace que el PR dispare evals en el CI.
