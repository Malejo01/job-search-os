# Informe de la tanda R28 «Lista para abrir» (25/11)

Pasos manuales: [`pasos-manuales-r28.md`](pasos-manuales-r28.md). Base: `origin/ronda/r27-integracion` (`main` + la R27 en un commit, con el favicon). USD 0 en modelos, ningún prompt tocado, nada contra Neon, Vercel ni Resend, ningún merge.

La tanda tuvo los 7 tickets del pedido (R28-01 a R28-07) y los 8 de la cola extra (R28-08 a R28-15, con R28-15 primero). Se terminaron los 15.

## Qué quedó

| Ticket | Qué | Rama |
|---|---|---|
| R28-01 | `global-error` con estilos propios (sin layout); capturas del festejo y de Hoy con el saludo; festejo a 390 px sin tapar la barra ni el asistente; LCP de la portada | `ronda/r28-01-afi-pendientes` |
| R28-02 | `86-cv-chat-repreguntas`: 3/3 en local, no se reproduce; espera de 5 a 20 s | `ronda/r28-01-afi-pendientes` |
| R28-03 | Checklist de apertura: términos del PR legal, voz en `all`, ruteo a Claude contra el seed, fecha definitiva | `ronda/r28-03-apertura` |
| R28-04 | e2e del alta completa con una persona inventada; email de bienvenida con una sola acción principal | `ronda/r28-03-apertura` |
| R28-05 | Recruitee y SmartRecruiters (apagadas, mismo contrato que Workable/Teamtailor), ADR-046, migración 0083 | `ronda/r28-05-fuentes` |
| R28-06 | `role_hints` de 8 carreras no técnicas en español e inglés (15+ positivos y negativos cada una) y regresión técnica; `pnpm pool:cobertura` | `ronda/r28-05-fuentes` |
| R28-07 | `boards-candidatos.md`: 3 boards verificados de 22 probados, SQL comentado | `ronda/r28-05-fuentes` |
| R28-15 | `<AfiDice>`: Afi que habla con burbuja en Hoy, Match, Interview, CV, Tracker, Preparar y Academy | `ronda/r28-15-afi-dice` |
| R28-10 | Revisión de seguridad de R25 a R27: 2 hallazgos (1 baja, 1 informativa), arreglados con test | `ronda/r28-10-seguridad` |
| R28-08 | Teclado y lector: foco en Interview y en el chat del CV; e2e por flujo | `ronda/r28-08-teclado` |
| R28-11 | Emails en los clientes de correo: esquema claro, `bgcolor`, Afi con respaldo, snapshots | `ronda/r28-11-emails` |
| R28-12 | `/ayuda` con 7 preguntas nuevas, Afi explicando, links en el pie, Ajustes y el asistente | `ronda/r28-12-ayuda` |
| R28-14 | Inventario de código muerto (2 archivos, borrado manual) | `ronda/r28-14-limpieza` |
| R28-09 | 360 px: controles de menos de 44 px de 63 a 0 en 32 pantallas; sin scroll horizontal ni texto cortado | `ronda/r28-09-celular` |
| R28-13 | Consultas con volumen: todo < 8 ms salvo `admin_beta_metrics()` (71 → 4 ms con la RLS 0068) | `ronda/r28-13-consultas` |

Las ramas van en cadena en ese orden; alcanza con integrar `ronda/r28-cierre`, que trae todo. **Carril rojo** (migración 0083, `schema.ts`, RLS 0068, `packages/db/src/**`, `lib/apertura.ts`).

## Decisiones del lead (lo más simple que falla cerrado)
- **LCP sin Lighthouse** (no está instalado y no se suman dependencias): Playwright con `PerformanceObserver`, CPU ×4 y red lenta, 5 corridas, con y sin Afi. El LCP es el título en 10 de 10. Con Afi en prioridad alta la mediana subía 1.224 ms; sin prioridad, 132 ms (tope 200). Los e2e corren con `next dev`: vale la comparación, no el número absoluto.
- **APIs públicas verificadas con búsqueda web** (el equipo no puede abrir esos dominios). Recruitee pide un token de cada empresa desde el 10/02/2027: el adaptador falla cerrado ante 401/403.
- **Boards candidatos:** solo se pueden verificar Greenhouse, Lever y Ashby. Quedaron 3, no 30: los tokens se adivinan y la mayoría no existe o no tiene remotos.
- **Afi que habla:** un solo Afi por pantalla. Los vacíos de Hoy e Interview quedan sin figura, y Hoy pierde la ilustración del encabezado.
- **Alta del plan sin festejo propio:** el ensayo verifica el festejo de la primera postulación. Un festejo de bienvenida queda como propuesta en `textos-para-ani.md`.
- **«A quién escribo» en `/ayuda`:** solo el botón «¿Algo no anduvo?». No hay canal público confirmado.
- **Foco al abrir el modal de comentarios con Enter:** dos vueltas de arreglo sin resultado. Queda `fixme` en el e2e 295 y se revirtió el intento.

## Verificación
- typecheck 6/6; lint sin errores (1 aviso previo en `feedback-button.tsx`); prettier.
- Unit: pipeline, web, adapters y db en verde (adapters con las 3 pruebas de symlinks que fallan en Windows, ajenas). Integración: equivalencia de `admin_beta_metrics` 5/5.
- e2e locales en verde: 270, 271, 273, 86-cv-chat-repreguntas (3/3), 278 (3; 2 salteados), 290–293, 185, 260, 69, 80, 228, 294, 296–298, 300–302, 306–308, 96-ayuda, 309.
- Salteados en local, corren en el CI: 276, 278 pasos 6 y 7, 299 (sin `ADMIN_EMAILS` ni precios). Pendiente: 295:19 (`fixme`).
- First Load: ninguna ruta sube más de 1 kB (`ops/`, build antes y después).
- Privacidad: ver el veredicto del cierre.

## No cumplido
- R28-07: 3 boards en lugar de 30, y 4 proveedores sin verificar.
- R28-05: las dos APIs nuevas no se probaron contra la API real.
- R28-06: no se encontró en el repo la consulta de cobertura del 13/11. `pool:cobertura` sigue el criterio de `readPoolCoverage`.
- R28-11: no hubo pruebas en Gmail, Outlook ni Apple Mail reales.
- R28-15: el LCP de Hoy no se midió aparte (el First Load de Hoy no cambió).
- R28-08: falta el foco inicial del modal de comentarios y el spec de teclado de `/cv/coach`.
