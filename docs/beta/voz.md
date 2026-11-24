# Voz: cómo funciona en cada navegador

Esta guía explica cómo dictás tus respuestas en la app, qué camino usa cada navegador y cómo dar permiso al micrófono. La voz es opcional: siempre podés escribir.

## Cómo funciona

Cuando tocás el micrófono, primero pedimos permiso para usarlo. Después hay dos caminos, según el navegador:

- **Dictado del navegador.** El navegador transcribe mientras hablás y ves el texto aparecer en vivo. El audio lo procesa el proveedor del navegador (por ejemplo, Google en Chrome); nosotros no lo recibimos.
- **Grabación y transcripción en el servidor.** Se graba lo que decís y, cuando tocás «Listo», se manda a nuestro servidor, que lo transcribe con un modelo de Google. El texto aparece al terminar, no en vivo. Mientras tanto ves una barra que se mueve con tu voz.

En los dos casos el texto cae en el campo para que lo corrijas antes de enviar. **Nunca se envía solo.** Con el segundo camino, el audio se procesa en memoria y se descarta: no lo guardamos. Cada grabación dura como máximo 2 minutos (te avisamos a 1:45) y hay un tope diario de minutos por persona.

No prometemos una precisión determinada: revisá siempre lo que quedó escrito.

## Tabla de compatibilidad

| Navegador | Camino | Texto en vivo |
|---|---|---|
| Chrome (computadora y Android) | Dictado del navegador | Sí |
| Edge | Dictado del navegador | Sí |
| Safari (macOS) | Dictado del navegador | Sí |
| Safari (iPhone y iPad) | Dictado del navegador | Sí |
| Firefox (computadora y Android) | Grabación + servidor | No |
| Firefox en iPhone | Grabación + servidor | No |
| Opera | Grabación + servidor | No |
| Opera GX | Grabación + servidor | No |
| Brave | Grabación + servidor | No |
| Samsung Internet | Dictado del navegador; si falla, pasa solo a grabación + servidor | Sí, si funciona |

Notas:

- Si el dictado del navegador falla a mitad de camino (por ejemplo, sin conexión con su servicio o sin permiso de reconocimiento), pasamos a grabación sin perder lo que ya dijiste.
- Si tu navegador necesita grabación y el servicio está apagado, ves un mensaje claro en lugar del botón. Ver la sección del interruptor.
- Esta tabla describe cómo elegimos el camino; los navegadores cambian, y es posible que alguno se comporte distinto a lo esperado. Si algo no anda, escribinos y mientras tanto podés escribir tu respuesta.
- Hace falta una conexión segura (https). En una página sin https el navegador no deja usar el micrófono.

## Cómo dar permiso al micrófono

Si tocás «No permitir» por error, el navegador no vuelve a preguntar: hay que cambiarlo a mano. Después de cambiarlo, recargá la página.

- **Chrome:** tocá el ícono a la izquierda de la dirección (candado o controles), entrá en «Configuración del sitio» o «Permisos», poné **Micrófono** en «Permitir». En Android: ícono de la barra de direcciones, «Permisos», «Micrófono».
- **Edge:** candado a la izquierda de la dirección, «Permisos de este sitio», **Micrófono** en «Permitir».
- **Safari en Mac:** menú Safari, «Configuración», pestaña «Sitios web», lista «Micrófono»: poné este sitio en «Permitir». El dictado también tiene que estar activo en el sistema (Ajustes del Sistema, Teclado, Dictado).
- **Safari en iPhone o iPad:** botón «aA» en la barra de direcciones, «Configuración del sitio web», **Micrófono** en «Permitir». Si no funciona, revisá Ajustes, Safari, Micrófono, y que el dictado esté activo en Ajustes, General, Teclado.
- **Firefox:** ícono del candado (o de permisos) a la izquierda de la dirección; si ves «Micrófono bloqueado», tocá la cruz para quitar el bloqueo y recargá. También: Configuración, Privacidad y seguridad, Permisos, Micrófono, «Configuración».
- **Opera:** candado en la barra de direcciones, **Micrófono** en «Permitir». Si no aparece el candado, abrí Configuración, Privacidad y seguridad, «Configuración del sitio», Micrófono.
- **Opera GX:** igual que Opera: candado en la barra de direcciones y **Micrófono** en «Permitir». También en Configuración, Privacidad y seguridad, «Configuración del sitio», Micrófono.
- **Brave:** candado a la izquierda de la dirección, **Micrófono** en «Permitir» (también en `brave://settings/content/microphone`). Los escudos de Brave no afectan al micrófono.
- **Samsung Internet:** menú (tres rayas), «Configuración», «Sitios y descargas», «Permisos del sitio», **Micrófono**, y permitilo para este sitio; o tocá el candado de la barra de direcciones.

Si el permiso del navegador está bien y el micrófono sigue sin andar, revisá el sistema operativo: en Windows, Configuración, Privacidad y seguridad, Micrófono; en macOS, Ajustes del Sistema, Privacidad y seguridad, Micrófono; en el celular, los permisos de la app del navegador.

## Si el servicio de transcripción está apagado (`VOICE_SERVER_TRANSCRIBE` en `off`)

El camino de grabación + servidor se prende con el interruptor `VOICE_SERVER_TRANSCRIBE`, que puede estar en `off`, `testers` o `all`. Viene en `off` por defecto.

- **Chrome, Edge y Safari** siguen andando igual: usan el dictado del navegador y no necesitan el servidor.
- **Firefox, Opera, Opera GX y Brave** no muestran el botón de grabar. En su lugar ves un mensaje que explica que la voz todavía no está disponible en tu navegador y que podés escribir o probar con Chrome, Edge o Safari.
- Con `testers`, solo lo ven las personas de la lista de prueba; con `all`, todas.
- Con el interruptor en `off` nada llama al modelo y nada se transcribe en el servidor.
