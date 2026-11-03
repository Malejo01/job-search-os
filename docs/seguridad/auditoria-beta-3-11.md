# Segunda auditoría de seguridad de la beta (3/11/2026, C8-14)

Revisión de lo que cambió desde la auditoría del 1/11 (`auditoria-beta-1-11.md`): las tandas C6, C7 y C8, o sea `git diff 2193128..ronda/integracion-c8` (107 commits, 289 archivos). La hizo la nube en dos lecturas independientes: una de un agente revisor que solo leyó el código (sin red ni base) y la propia, que verificó cada hallazgo en el código antes de arreglarlo. No es una auditoría externa ni un pentest.

## Resultado en una línea

**Ningún BLOQUEANTE.** No hay fuga de datos, bypass de admin, XSS ni inyección en lo nuevo. Tres **SUGERENCIAS**: la primera se arregló en este PR (con test), la segunda es de configuración (firewall de Vercel) y la tercera se arregló a medias (doble clic) y deja una decisión para Mauro.

## Hallazgos

| ID | Clase | Hallazgo | Estado |
| --- | --- | --- | --- |
| S-1 | SUGERENCIA | **Con la ventana del evento del 11/11, una sola IP podía llenar la ráfaga global.** `waitlist_join_event` usaba 200 por IP por hora y 200 cada 10 minutos: con el `?origen=voces-jovenes` proyectado en pantalla, unos 200 pedidos desde una sola conexión dejaban en «Recibimos muchos pedidos» a todo el salón durante 10 minutos, justo en el pico, y en unas 3 horas llenaban el tope diario de 600. Con los topes normales hacían falta al menos dos IPs. | **Arreglado en este PR:** el tope por IP del evento baja a **120** (`rls/0006`), por debajo de la ráfaga de 200; el salón (60 personas) sigue entrando. Test: el pedido 121 de la misma IP rebota y otra IP en los mismos 10 minutos sigue entrando. El checklist del evento ahora pide cargar `WAITLIST_EVENT_WINDOW` **solo con el horario real de la charla (2 a 3 h)**; el ejemplo pasó de 17–23 a 19–22. |
| S-2 | SUGERENCIA (configuración) | **`trackAcceso` (embudo de `/acceso`) es una acción pública sin tope.** Con `ACCESO_FUNNEL_ENABLED=1`, un script puede inflar visitas, formularios empezados y carreras, y cada llamada es una escritura en Neon sobre la misma fila por hora. Solo afecta métricas y algo de carga: el origen sale de una lista cerrada (en la web y con un check en la base), el paso y la carrera se validan y no se guardan personas. | **Pendiente (Mauro):** una regla del firewall de Vercel para `POST /acceso` por IP, con un umbral que no corte al salón (por ejemplo, 120 por minuto). Cubre también `submitWaitlist` (ya lo proponía B-7 del 1/11). Alternativa: prender el embudo solo los días de evento. |
| S-3 | SUGERENCIA | **La bienvenida (C8-7) suma envíos al cupo de Resend sin contarse** en `/settings/salud`, y **dos envíos simultáneos del formulario de `/settings/planes` podían mandar dos bienvenidas** (`isPlanActivation` compara contra una lectura previa sin lock). Solo afecta a admins. | **Doble clic arreglado en este PR:** el botón «Activar 30 días» se deshabilita mientras la acción corre (`SubmitButton`). **Pendiente (Mauro):** no prender `WELCOME_EMAIL_ENABLED` hasta resolver el presupuesto de Resend (M-3 del 1/11), o contarlas. Dos pestañas a la vez siguen pudiendo mandar dos: para eso haría falta una marca en la base (migración). |

## Lo que se revisó y está bien

- **Rutas públicas (`auth.config.ts`):** lo nuevo es `/icon.svg`, `/apple-icon.png`, `/manifest.webmanifest` y `/icons/*`; bajo `/icons` solo hay PNG estáticos. Las fuentes locales van por `/_next/static`, ya excluido en `middleware.ts`. `middleware.ts` y `auth.ts` no cambiaron.
- **Re-aceptación de términos:** `TERMS_VERSION` 2026-11-02 hace que todas las cuentas vuelvan a aceptar; el chequeo sigue en los layouts de `(app)` y `onboarding`.
- **`/acceso` (`submitWaitlist`):** el origen solo se usa normalizado a la lista cerrada `ACCESO_ORIGINS`; el campo oculto se recorta a 40 caracteres y no llega a `heard_from`. Honeypot, Zod y la misma respuesta para alta y duplicado, como antes. La IP sale primero de `x-vercel-forwarded-for` (Vercel la pisa).
- **SQL de la lista de espera (`rls/0006`):** `waitlist_join_limited` no es `SECURITY DEFINER` y no tiene `EXECUTE` para la app (test); sus topes están acotados entre 1 y 200; los envoltorios `waitlist_join` y `waitlist_join_event` tienen `search_path` fijo, `REVOKE`/`GRANT` correctos y caso en `multiusuario.integration`.
- **Embudo (`0057`, `rls/0016`):** RLS sin policies, `REVOKE` a la app, checks en la tabla y en la función, `acceso_funnel_admin` con barrera `app_admins` y tope de días y filas.
- **`/settings/salud`:** la barrera de admin va antes de cualquier lectura con la conexión de servicio; devuelve solo conteos agregados, con timeout de 3 s y caché de 5 minutos.
- **`/settings/metricas`, `/settings/marca` y `/settings/marca/email-bienvenida`:** 404 para quien no es admin; la ruta del email devuelve un HTML de ejemplo con constantes y `no-store`.
- **`/settings/planes`:** sesión y admin en cada acción; `after()` manda solo a la persona activada; el log lleva el `user_id` del admin y el origen del plan, y de un error de Resend solo el código HTTP.
- **Invitaciones y `MP_LINK_LISTA`:** `paymentLink` exige `https`, sin usuario, contraseña ni puerto, y un host de `PAYMENT_HOSTS`; si no, el mensaje dice que el link llega aparte (test con un host ajeno).
- **Emails:** `brandedEmailHtml` y `textToEmailHtml` escapan todo y solo enlazan URLs `http(s)` con el `href` escapado; el soporte sigue escapando campo por campo; la bienvenida y los avisos de vencimiento no llevan datos de terceros y el nombre se recorta a la primera palabra.
- **Imágenes OG:** no reciben parámetros, leen fuentes del repo y no salen a la red: sin SSRF ni cómputo por pedido.
- **Headers y CSP (`next.config.ts` no cambió):** las fuentes son locales; «Pasáselo a alguien» usa `navigator.share` y el portapapeles, que la `Permissions-Policy` no bloquea, y no manda nada al servidor.
- **`dangerouslySetInnerHTML`:** ninguno nuevo.
- **Otros:** las acciones nuevas (`closeStartHereAction`, `trackAcceso`, `markVisitAction`) validan sesión o entrada; «Empezá acá» y la ayuda leen con RLS; las fixtures nuevas no tienen emails ni secretos.

## Qué hace Mauro

1. Antes del 11/11: regla del firewall de Vercel para `POST /acceso` (S-2) y `WAITLIST_EVENT_WINDOW` con el horario real de la charla (S-1).
2. Antes del 26/11: decidir el presupuesto de Resend (M-3) antes de prender `WELCOME_EMAIL_ENABLED` (S-3).
