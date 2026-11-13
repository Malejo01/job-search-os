# Informe de la tanda R7 «Pre-beta: costos, seguridad y pulido» (13/11, madrugada)

Tres agentes trabajaron en paralelo, cada uno en su worktree: costos, seguridad y pulido. El lead revisó, commiteó, pasó la revisión de privacidad (más la de seguridad o de código donde tocaba) y abrió los PR. **Ningún PR se mergeó.** Todos salen de `main` y no dependen de la R5 ni de la R6.

## 1. PRs, en el orden de merge sugerido (después de la R5 y la R6)

| Orden | PR | Ticket | Carril | Antes de mergear |
|---|---|---|---|---|
| 1 | [#476](https://github.com/Malejo01/job-search-os/pull/476) | R7-7 · kit del ensayo | verde (docs) | — |
| 2 | [#475](https://github.com/Malejo01/job-search-os/pull/475) | R7-5 · accesibilidad con axe | verde | Mirar qué marca el e2e 131 en el CI |
| 3 | [#471](https://github.com/Malejo01/job-search-os/pull/471) | R7-3 · asistente: tope y mensajes que quedan | rojo (una línea de `app/api`) | — |
| 4 | [#473](https://github.com/Malejo01/job-search-os/pull/473) | R7-6 · pantallas lentas | verde | Después de #458 y #465: los tres tocan `jobs/page.tsx`, y #458 también `settings/page.tsx` (§3) |
| 5 | [#474](https://github.com/Malejo01/job-search-os/pull/474) | R7-4 · auditoría de seguridad | rojo (test en `packages/db/src`) | — |
| 6 | [#472](https://github.com/Malejo01/job-search-os/pull/472) | R7-1 · alertas de presupuesto | rojo | `RESEND_API_KEY`, `EMAIL_FROM` y `ADMIN_EMAILS` en Vercel (§5) |
| 7 | [#477](https://github.com/Malejo01/job-search-os/pull/477) | R7-2 · no reevaluar duplicados | rojo | — |
| 8 | este PR | Cierre de la R7 | verde | Al final, después de #464 y #470 (sale de `ronda/r6-cierre`) |

Ninguna de la R7 trae migración.

## 2. Cómo se probó cada uno

| Ticket | Pruebas |
|---|---|
| R7-1 | Tests primero en pipeline (13 casos de umbrales y «una vez por día»). Adapters: 19 tests con Resend falso. Integración con Docker (5): dos corridas seguidas y dos en paralelo mandan un solo email; al otro día vuelve a avisar; si falla el envío, devuelve la marca; la marca no suma en los reportes de gasto. Revisión de seguridad: OK, con 4 observaciones bajas (§3). |
| R7-2 | Tests primero en pipeline (dedup: 105). Integración con Docker y modelo falso (9): reutiliza con 0 llamadas; vuelve a llamar si cambian el perfil, los criterios, el título o la JD después de evaluar, o si la evaluación previa no tiene `inputs`; no reutiliza de otra persona. Integración completa de adapters: 413 tests. Seguridad, dos vueltas: la primera marcó dos observaciones medias (se comparaba el hash actual del job previo, y había una carrera con ediciones del perfil); el arreglo exige igualdad exacta con lo leído antes de la llamada, y la segunda vuelta dio OK. |
| R7-3 | Tests primero en pipeline (`limits.ts`); e2e 132 con `LLM_DEMO` (lo corre el CI). |
| R7-4 | Test de cobertura de RLS: 4 de 4 en Docker local. Integración de db completa: 437 de 438; el único fallo fue la primera versión del test, ya corregida. |
| R7-5 | Typecheck y lint verdes; e2e 131 lo corre el CI (es la primera medición). |
| R7-6 | Typecheck y lint verdes. Revisión de código: OK, con una observación media (pool, §3). |
| R7-7 | Prettier; revisión de privacidad. |

Todos: revisión de privacidad PASA antes de cada push y el pre-push sin hallazgos. Ninguna llamada paga a un LLM y ningún email real.

## 3. Qué quedó afuera y observaciones

- **El PR de integración no se armó.** El pedido era una rama `ronda/integracion-r5-r7` con `git merge --no-ff` de cada rama. El guard bloquea `git merge` para los agentes («no permitido para el equipo», CLAUDE.local.md §3.14), y no se buscó otro camino. El plan con el orden, los comandos y los choques previstos está en `docs/beta/manana-13-11.md` §2, para que Mauro lo corra o habilite el comando.
- **R7-6 no se midió.** `next start` sin `DB_TARGET=local` apunta a Neon, y la base local está vacía. Los tiempos «antes y después» los mide Mauro en la preview (`docs/beta/rendimiento-r7.md`).
- **R7-6, pool de conexiones** (revisión de código, media): `getAppDb` usa `max: 5` (`apps/web/lib/db.ts`, carril rojo). El layout más la página pueden abrir más de 12 transacciones a la vez. No hay deadlock, pero bajo carga puede haber espera. Medir y, si hace falta, subir `max` mirando el límite de Neon.
- **R7-1, decisiones:**
  - la marca «ya avisado» va en `llm_calls`, sin migración;
  - el aviso sale desde el cron de evaluación, que corre cada 6 h, así que puede llegar hasta 6 h tarde;
  - observaciones bajas de seguridad: si el cron se corta entre marcar y enviar, ese día no se avisa; un envío parcial no se reintenta; la clave de idempotencia usa el índice del destinatario; `/settings/salud` puede estar 5 minutos atrasada.
- **R7-2, límites:**
  - el ahorro empieza con las evaluaciones nuevas, porque las anteriores no tienen `inputs`;
  - que el perfil no cambió se mide con `profiles.updated_at`, así que una edición a mano en SQL no se detecta;
  - la búsqueda por `decision->'inputs'->>'jd_hash'` no tiene índice; está acotada por `user_id` y, si resultara lenta, haría falta un índice funcional, que es una migración aparte;
  - observación informativa de seguridad: si un job sin texto de JD tuviera `jd_hash`, podría reutilizarse una evaluación hecha sin JD. Es un riesgo de calidad, no de datos.
- **R7-4:** `pnpm secrets:scan` no corrió porque el guard lo bloquea. HSTS y la regla de firewall del login se verifican en producción. Los umbrales exactos y el detalle de los dos P2 abiertos quedaron fuera del repo público (regla de informes de seguridad); Mauro los tiene en `ops/rondas/r7-tanda/R7-4/`.
- **R7-5:** no cambió componentes. Si el CI marca violaciones graves, se arreglan en un seguimiento.
- **R7-7:** en el código no existe `/admin`. El kit usa `/settings/salud`, `/settings/metricas`, `/settings/invitations` y `/settings/planes`. Los umbrales de `decision-25-11.md` son una propuesta para que Mauro ajuste.

## 4. Migraciones sin aplicar

Ninguna de la R7. Las pendientes son de la R5 y la R6: 0061 con `rls/0012`, 0062 y 0063 (`docs/beta/informe-r6.md` §4).

## 5. Pasos manuales para Mauro, en orden

1. `! pnpm secrets:scan`, con Docker abierto.
2. **Vercel:** confirmar que estén `RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_EMAILS` y `LLM_DAILY_CAP_USD` (R7-1). Sin alguna de ellas, las alertas no salen; solo queda un aviso en el log.
3. **Producción:** verificar que llegue el header HSTS y que la regla de firewall del login siga activa en el panel de Vercel (R7-4).
4. **Después del primer CI de #475:** pasar las violaciones leves a `docs/beta/accesibilidad-r7.md` y pedir el arreglo de las graves, si las hay.
5. **En la preview:** medir las pantallas de R7-6 con la tabla de `docs/beta/rendimiento-r7.md`.
6. **Ajustar los criterios** de `docs/beta/ensayo/decision-25-11.md` antes del 23/11.
