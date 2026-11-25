# Afi · recursos de la mascota (v2, 25/11)

Mascota 3D de AfinIAJobs, **versión 2 (25/11)**: gato gris con anteojos negros, ojos verde lima, traje violeta, corbata lima y pin «A». Reemplaza a la v1 (visor y auriculares, 24/11) con los mismos nombres de archivo. Las originales (1024×1024, fondo blanco) salieron de Gemini con `claude/videos/prompt-gemini-afi-v2-9-poses-25-11.md`. Claude les sacó el fondo (rembg `isnet-general-use` + relleno del blanco desde los bordes; los hologramas de `explicando` y `analizando` con transparencia real), las recortó al personaje y armó los tamaños. Plan: `ops/rondas/r27-tanda/prompt-r27.md`.

## Poses (`apps/web/public/mascota/`)
Cada pose tiene `<pose>-256.webp`, `<pose>-512.webp` y `<pose>-1024.webp` (alto en px, fondo transparente) y `<pose>-512.png` (para emails).

| Archivo | Qué hace | Dónde va |
|---|---|---|
| `saludando` | Saluda con la mano | Hoy (primera vez del día), bienvenida, portada, email de bienvenida |
| `trabajando` | En la laptop, sentado al escritorio | «Evaluando ofertas…», Match vacío, lista de espera |
| `pensando` | Mano en el mentón | Asistente pensando, «Transcribiendo…», cargas de IA |
| `explicando` | Con un gráfico holográfico al lado | Academy, diagnóstico del CV, ayudas «?», detalle del sello |
| `quieto` | Tablet en el brazo y una mano en el bolsillo | Vacíos genéricos, 404; de acá sale la cara |
| `hablando-1` | Habla y te señala con la palma arriba | Interview: la pregunta; asistente hablando |
| `hablando-2` | Sonríe con las dos manos abiertas | Interview: devolución e informe; voz |
| `motivacion` | Festeja con el puño arriba | Logros: postulación enviada, CV mejorado, plan activado |
| `analizando` | Mira su tablet con un panel holográfico encima | Tracker, Preparar mi postulación, errores «lo estamos revisando» |

Pesos: unos 14–20 kB a 256 px, 30–40 kB a 512 px y 70–110 kB a 1024 px (WebP). El PNG de 512 px pesa unos 190 kB: solo para emails.

## Cara y favicon
- `cara-48`, `cara-96`, `cara-192` y `cara-512` (`.webp` y `.png`), transparentes, recortadas de `quieto`: el botón del asistente.
- `favicon/`: la cara sobre un círculo lavanda (`#eeedf9`). Tamaños 16, 32, 48, 180, 192 y 512, más `favicon.ico` (16, 32 y 48). A 16 px solo se lee la silueta y la sonrisa lima.
