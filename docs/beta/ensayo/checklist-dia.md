# Checklist del día del ensayo (23 y 24/11)

Para Mauro y Ani. Complementa, sin repetirlos, el recorrido de `docs/beta/ensayo.md` (qué hace quien organiza), la guía de testers `docs/beta/ensayo-testers.md` y el runbook `docs/beta/runbook-apertura.md` (variables, qué mirar y qué hacer si algo falla, §2.3 y §3).

Los horarios son de Argentina y sugeridos: ajustalos a cuándo cite Ani a cada grupo.

> En el código no existe una pantalla `/admin`. Lo de administración vive en **Ajustes**: `/settings/salud` (estado del sistema), `/settings/metricas` (gente activa, 👍 y reportes, con el triage del feedback si `FEEDBACK_TRIAGE_ENABLED=1`), `/settings/invitations` y `/settings/planes`. Donde esta lista dice «panel», es una de esas.

## Antes (la noche anterior y la mañana)

Quién: Mauro, salvo lo marcado.

- [ ] **22/11, noche:** lo del ensayo largo, «Antes de empezar» (`ensayo.md`): migraciones y variables de Vercel aplicadas, redeploy hecho. Lo hace Mauro, nadie más.
- [ ] **7:30** `/settings/salud` en verde; `/api/health` responde.
- [ ] **7:45** Tope de gasto de IA confirmado (`LLM_DAILY_CAP_USD`, ver `capacidad.md` §6) y `pnpm llm:spend --days 1` como punto de partida.
- [ ] **8:00** Una invitación por tester desde `/settings/invitations`, creada con anticipación (vencen a los 14 días, sirven una vez). Los links se copian en el momento: se muestran una sola vez.
- [ ] **8:15** Un tester de cada carrera como mínimo anotado en una planilla propia (nombre de pila y carrera; sin más datos personales en ningún archivo del repo).
- [ ] **8:30** Ani: lista de quién prueba a qué hora, el grupo de WhatsApp o el canal de ayuda abiertos y el texto «cómo pedir ayuda» listo (`ensayo-testers.md` §4).
- [ ] **8:45** Mauro: pestañas abiertas (`/settings/salud`, `/settings/metricas`, Vercel Logs, Neon Monitoring). Docker no hace falta en producción.
- [ ] Dos celulares (uno con datos móviles) y una PC; uno en modo claro y otro en oscuro.

## Durante (con testers)

Sugerido: dos tandas de 30 minutos de prueba más 15 de margen cada una.

| Cuándo | Quién | Qué |
| --- | --- | --- |
| Al arrancar cada tanda | Ani | Manda el link personal a cada tester y recuerda que es una sola vez |
| Cada 15 min | Mauro | `/settings/salud` y `/settings/metricas`: ¿entran cuentas nuevas?, ¿hay reportes nuevos? |
| Cada 30 min | Mauro | Gasto de IA: `pnpm llm:spend --days 1`. Si pasa de USD 1,5 en el día, mirar de quién es antes de tocar el tope |
| Siempre | Ani | Atiende dudas; anota la frase exacta que confundió y la carrera. No arregla nada en vivo |
| Siempre | Mauro | Vercel Logs con filtro *Error*; Neon Monitoring (transferencia y cómputo) |

Qué mirar en el panel, concretamente:

- **`/settings/salud`:** todo en verde. Si algo pasa a amarillo o rojo, avisar a Mauro en voz alta.
- **`/settings/metricas`:** cantidad de personas activas, 👍/👎 y reportes de «¿Algo no anduvo?» (los más nuevos primero).
- **Cuentas:** que cada tester haya completado el onboarding (si alguien quedó trabado en el paso 1, es el hallazgo más importante).

### Si algo se cae

Primero comunicar («estamos viendo algo, sigan con otra parte»), después arreglar. No se tocan datos en producción para salir del paso.

| Qué pasa | Qué hacer | Dónde está el detalle |
| --- | --- | --- |
| La app no carga o da 500 | Rollback del último deploy en Vercel (antes de investigar) | `runbook-apertura.md` §3.2 |
| Un tester no puede entrar | Revocar y crear otra invitación; contraseña olvidada por `/forgot-password` | `runbook-apertura.md` §3.4 |
| No salen emails | Mirar Resend (dominio, cuota de 100 por día) | `runbook-apertura.md` §3.5 |
| Muchos «hay muchos pedidos» desde el mismo wifi | Esperar un minuto; probar con datos móviles | `runbook-apertura.md` §3.4 y §3.6 |
| Neon cerca del límite | Pausar monitores y, si hace falta, el cron | `runbook-apertura.md` §3.1 |
| El gasto de IA sube de golpe | Ver de quién es (`llm:spend`); si es un tester, avisarle; no subir el tope en caliente | `capacidad.md` |
| Las ofertas no llegan o tardan | Es normal unos minutos al principio; si pasa de 15, mirar la cola en `/api/cron/status` | `runbook-apertura.md` §2.3 |
| Algo se ve mal pero se puede seguir | Anotar y mandar «¿Algo no anduvo?»; no cortar la prueba | `feedback-y-triage.md` |

## Después (ese mismo día y a la mañana siguiente)

- [ ] **Al cierre de cada tanda** (Ani y Mauro, 15 minutos): cada tester completa su planilla (`ensayo-testers.md` §5) y se juntan.
- [ ] **Esa noche (Mauro):** abrir el triage (`/settings/metricas`) y clasificar todo lo nuevo en P0, P1 o P2 (`feedback-y-triage.md`). Dejar cada uno en «Visto» o «Resuelto».
- [ ] **Esa noche:** `pnpm llm:spend --days 1`: anotar el gasto del día contra el tope.
- [ ] **24/11, noche:** completar la tabla de `decision-25-11.md` con los números del día.
- [ ] **No** borrar las cuentas de prueba ni los comentarios hasta después de la decisión del 25/11.
