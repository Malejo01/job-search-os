# QA relaciones públicas

Persona: Rocío Ficticia (`rocio`). Capturas: `rocio-acceso-390|1280.png`.

- **/acceso (P2, conocido, lo arregla C3):** el chip «Relaciones públicas» se elige y se ve marcado, pero guarda `marketing_digital` en vez de `relaciones_publicas`. Archivo: `apps/web/app/(public)/acceso/page.tsx:37`. La prueba falló por eso y, al estar en serie, no corrió el resto.
- Registro, onboarding, ofertas, /hoy, /jobs, detalle, Perfil, CV y ayuda: sin verificar en local. El spec ahora separa /acceso del recorrido; en main el puesto del onboarding es «Marketing y relaciones públicas».
- Prefiltro sobre 6 avisos sintéticos (`relaciones_publicas.json`) con la clave `marketing_digital`: verde, sin hallazgos.

Repetir sobre la rama de C3 (parte 2).
