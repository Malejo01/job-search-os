# Informe de la cadena R30 a R34 · del informe de revisión a la beta

Cinco tandas encadenadas, del 26 al 27/11, sobre el plan `docs/beta/plan-r30-r34.md`. Todo con datos inventados y el modelo simulado: **USD 0 en modelos**, nada contra Neon, Vercel ni Resend, **ningún merge**. Cada tanda tiene su informe y sus pasos manuales; acá van juntos lo hecho, lo que falta para cada compuerta y todos los pasos manuales en orden. Estado de cada uno de los 159 puntos del informe de revisión: `docs/beta/verificacion-informe-ani.md`.

## 1. Qué quedó hecho

Las ramas están **en cadena**: cada tanda sale del cierre de la anterior, así que `ronda/r34-cierre` contiene todo. Ninguna está en `main`.

| Tanda | Rama de cierre | Qué entró | Informe |
|---|---|---|---|
| R30 «Confianza» | `ronda/r30-cierre` | Glosario único con test, sellos de afinidad, listado y tarjeta, filtros como chips, descartadas, «Guardada» (0086), vigencia, detalle y «Cómo se calculó», «Preparar mi postulación», valoración, base de legibilidad y parser de sueldo | `informe-r30.md` |
| R31 «Ficha del aviso» | `ronda/r31-cierre` | Ficha verificada del aviso (`job_cards`, 0087 y RLS 0071), respuestas de un toque (0088 y RLS 0072), detalle en español, tabla con filas del aviso, `evaluate_job@v1.5.0` sin promover, reevaluación única con tope y calibración (RLS 0073). Todo detrás de `JOB_CARD`, apagada | `informe-r31.md` |
| R32 «Inventario y alta» | `ronda/r32-cierre` | Carrera obligatoria en el alta, panel de cobertura, apertura por carrera (0089 y RLS 0074), guía de alertas, fuentes Jooble y ReliefWeb (0090), sueldo en la moneda original y email de novedades | `informe-r32.md` |
| R33 «CV» | `ronda/r33-cierre` | «Tu CV» con tres estados, borrador de los asistentes (0091 y RLS 0075), los dos asistentes guiados, revisión, diagnóstico, contacto y links, PDF propio sin dependencia (ADR-049) y legibilidad del CV. Además, los arreglos del CI del PR de integración y **el cierre de seguridad de la baja del email de novedades** (re-aplicar la RLS 0074) | `informe-r33.md` |
| R34 «Barrido y cierre» | `ronda/r34-cierre` | Legibilidad estricta en toda la app de usuario, el CV desde la oferta con hasta 3 versiones (0092, 0093, RLS 0076 y 0077), `/market` mínimo, seguimiento mínimo, ensayo de punta a punta, `decide()` que falla cerrado con reglas vacías, los arreglos del CI del PR de integración #571 (R34-08) y el cotejo de los textos con el informe | `informe-r34.md` |

**La R32 no se integra sin la R33:** con la R32 sola, cualquier cuenta podía dar de baja a otra del email de novedades.

## 2. Lo que falta para la compuerta A · abre la primera carrera

Según el plan §14, punto por punto:

| Requisito | Estado | Qué falta y quién |
|---|---|---|
| La R30, la R31 y la R32 en `main` | **Pendiente** | El responsable integra la cadena (paso 1 de la sección 4). La R32 va con la R33 |
| Al menos una carrera sobre el umbral | **Pendiente** (depende de datos reales) | El responsable mira `/admin/cobertura` con el pool de producción y abre la carrera (pasos de la R32, §7). Antes: las claves de Jooble y ReliefWeb y las alertas de Computrabajo de la revisora |
| Ninguna contradicción en la evaluación | **Parcial**: el código está (ficha del aviso, tabla con filas del aviso y `decide()` que falla cerrado con reglas vacías) | Medir `evaluate_job@v1.5.0` con evals pagas, calibrar con 20 a 30 ofertas marcadas por la revisora y el responsable, promoverla y la reevaluación única (pasos de la R31, §4 a §8). Gasto a aprobar por el responsable |
| Ningún aviso vencido sin avisar | **Hecho en código** (R30: vigencia y aviso de vencida) | Comprobarlo en producción después de integrar |
| Todo usable a 390 px | **Hecho en local**: auditorías de legibilidad 431 (CV) y 440 (resto) a 390 y 1280 px, claro y oscuro, zoom 200 %; teclado y axe en lo tocado | Revisión de diseño de las auditorías (`ops/capturas/r34/legibilidad/`) |
| Las evals en verde | **Pendiente** | Las corre el responsable (son pagas; comandos en los pasos de la R31, §4) |
| Checklist de apertura completa | **Pendiente** | En `/admin` después de integrar: se completa con lo de arriba |

## 3. Lo que falta para la compuerta B · beta completa

| Requisito | Estado | Qué falta y quién |
|---|---|---|
| La R33 y la R34 en `main` | **Pendiente** | El responsable integra (sección 4) |
| El CV de punta a punta | **Hecho en código y en e2e** (R33: dos caminos, PDF y DOCX; R34: revisar, adaptar, versiones, descargar y postularse; e2e 445 con el modelo simulado) | Abrir el PDF y el DOCX en tres lectores reales e imprimir (pasos de la R33, §5); probar el chat y el coach con la revisora (pasos de la R33, §6) |
| Un ensayo con 5 personas en el que al menos 4 completan el recorrido | **Pendiente** (el guion está: `docs/beta/ensayo-beta.md`) | La revisora consigue a las 5 personas; se hace con la cadena integrada |
| La legibilidad revisada en toda la app de usuario | **Hecho en automático** (lista de excepciones vacía salvo el admin; auditorías 431 y 440) | La revisión de diseño sobre las capturas |

## 4. Todos los pasos manuales, en orden

Cada paso remite a la sección de los pasos manuales de su tanda, donde está el SQL completo, la verificación de solo lectura y qué pasa si no se hace.

**A. Integrar (carril rojo, lo mergea el responsable)**
1. Integrar la cadena en orden R30 → R31 → R32 → R33 → R34. Como las ramas están en cadena, `ronda/r34-cierre` trae las cinco. Cada tanda lista sus archivos rojos en el §1 de sus pasos manuales.

**B. Base de datos en Neon, antes de desplegar el código** (en este orden, revisando cada SQL, confirmando con `si`, nunca `db:seed`)
2. Migración 0086 (`jobs.saved_at`) · R30 §2.
3. Migración 0087 y RLS 0071 (`job_cards`), migración 0088 y RLS 0072 (`requirement_answers`), RLS 0073 (calibración) · R31 §2.
4. Migración 0089 y RLS 0074 (apertura por carrera y email de novedades) y migración 0090 (ReliefWeb y sueldo original) · R32 §2. **Usá la RLS 0074 de la R33** (con el `REVOKE`); si ya aplicaste la de la R32, volvé a aplicarla · R33 §1b.
5. `news_email = false` para todas las cuentas con un `UPDATE` puntual, después de la 0089 · R34 §3 (reemplaza la decisión pendiente de R32 §3).
6. Migración 0091 y RLS 0075 (`cv_drafts`) · R33 §2.
7. Migraciones 0092 y 0093 y RLS 0076 y 0077 (`cv_offer_versions`, tope de 3) · R34 §2.

**C. Desplegar y configurar**
8. Desplegar el código integrado.
9. La fila de `model_routing` de la ficha (`extract_job_card`) · R31 §3.
10. Las claves de Jooble y ReliefWeb, con `--dry-run` de cada fuente antes de prenderla · R32 §4.

**D. Modelos (gasto a aprobar por el responsable)**
11. Evals de `evaluate_job@v1.5.0` contra la vigente · R31 §4.
12. `JOB_CARD=testers` y sus topes · R31 §5.
13. Calibración con la revisora (20 a 30 ofertas) · R31 §6.
14. Promover `evaluate_job@v1.5.0` solo con 11 y 13 a favor · R31 §7.
15. La reevaluación única, con dry-run primero y tope en USD · R31 §8.

**E. Abrir la primera carrera**
16. La revisora crea las alertas de Computrabajo por carrera · R32 §5. Empresas regionales · R32 §6.
17. Mirar `/admin/cobertura` y abrir la carrera · R32 §7. Cumplir «Te avisamos por email apenas abra» · R32 §8.
18. Revisar los emails de Get on Board que fallaron · R32 §9.

**F. Pruebas con personas**
19. Las pantallas de la R30 con la revisora y los textos para aprobar · R30 §3 y §4.
20. El PDF y el DOCX en tres lectores y en papel · R33 §5. Los dos caminos del CV con la revisora · R33 §6.
21. El ensayo con 5 personas (compuerta B) · R34 §7 y `docs/beta/ensayo-beta.md`.

**G. Pendientes que van en PR aparte**
22. Las purgas de borradores del CV y de fichas huérfanas: PR rojo aparte, sin tocar el cron en esta cadena · R34 §4 (antes R31 §9 y R33 §3).

**G2. Lo que quedó sin correr**
22b. Terminar la auditoría de legibilidad 440 con el build de producción (tres casos al 200 %) · R34 §8.
22c. Decidir si el inglés del alta cuenta para ocultar la puerta de «Tu CV» · `informe-r34.md`, «No cumplido o con reservas».

**H. Limpieza local**
23. Borrar los cuatro componentes de `/market` sin uso y la rama local vieja del cotejo · R34 §5. Limpieza y e2e de la R30 · R30 §6.
24. `NODE_OPTIONS` para correr tests pesados en local · R34 §6.

## 5. Lo que ninguna tanda hace sola

| Quién | Qué | Para qué |
|---|---|---|
| Responsable | Integrar cada tanda, aplicar las migraciones en Neon y mergear el carril rojo | Todas |
| Responsable | Correr las evals de `evaluate_job` y de la ficha, promover los prompts y prender las variables | R31, R33 |
| Responsable | Aprobar el gasto de la reevaluación única | R31 |
| Responsable | Registrar las claves de Jooble y de ReliefWeb | R32 |
| La revisora y el responsable | Marcar entre 20 y 30 ofertas para calibrar la evaluación nueva | R31 |
| La revisora | Crear las alertas de Computrabajo por carrera y aprobar los textos | R32, todas |
| La revisora | Probar el coach y el chat del CV | R33 |
| Diseño | Revisar las auditorías de legibilidad | R30, R33, R34 |
| La revisora | Conseguir 5 personas para el ensayo | Compuerta B |

## 6. Cómo se trabajó y qué no se pudo

- Los e2e corrieron con `next dev` en la máquina local, **de a un spec**: con varios a la vez el sistema cortó por memoria (R29, R33 y R34). Vitest con `--maxWorkers=4`, turbo con `--concurrency=2` y Playwright con un worker.
- El guard no deja instalar, borrar, copiar ni fijar variables de entorno: lo que hacía falta quedó como comando en los pasos manuales.
- `gitleaks` no se pudo correr desde la sesión (guard); se revisó a mano.
- Tres unitarios de `privacy-scan` en adapters dan `EPERM` en Windows (symlinks sin modo desarrollador); en el CI (Linux) corren.
- Los textos del informe de revisión se cotejaron por ID contra su texto; cuando el informe contradice al plan, gana el plan y la diferencia queda anotada en la verificación.
