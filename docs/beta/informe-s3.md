# Informe de la tanda S3 «Seguridad sin perder velocidad» (19/11)

La tanda sigue el endurecimiento de la S2 con topes de entrada, reservas de gasto sin cola, cupos de correo, sesiones, permisos de base y CI. Cada control tiene su impacto en rendimiento medido. Ningún agente mergeó nada.

Base: `origin/main` en abe5604 (#540).

## Cómo están armadas las ramas

Todas las ramas de la tanda forman **una sola cadena**: cada ticket es un commit y cada rama apunta a su commit, así que cada una contiene a las anteriores. Se integran en este orden, o alcanza con integrar la última (`ronda/s3-cierre`), que trae todo. Para integrar un ticket suelto se toma su commit.

| # | Rama | Qué hace |
|---|---|---|
| 1 | `ronda/s3-06-carril-rojo-controles` | Amplía el carril rojo con los controles de acceso y gasto |
| 2 | `ronda/s3-17-detector-afinado` | Afina la detección de instrucciones en los avisos |
| 3 | `ronda/s3-16-titulo-borradores` | Título del aviso en una línea y acotado en los borradores |
| 4 | `ronda/s3-19-errores-mcp` | Errores fijos en todas las tools del MCP |
| 5 | `ronda/s3-02-fallas-sin-gasto` | Las fallas que el proveedor no factura no cuentan como gasto |
| 6 | `ronda/s3-03-intentos-por-ip` | Intentos de login por email e IP, limpios al restablecer |
| 7 | `ronda/s3-12-cerrar-todo` | Cerrar todas las sesiones también revoca el acceso externo |
| 8 | `ronda/s3-13-cookie-produccion` | Cookie segura en producción sin depender de `AUTH_URL` |
| 9 | `ronda/s3-01-entrada-correo-acotada` | Entrada del clasificador acotada y email contado antes de procesarlo |
| 10 | `ronda/s3-04-reintento-cuerpo` | Reintento del email si falla la lectura del cuerpo |
| 11 | `ronda/s3-23-intentos-acotados` | Tabla de intentos acotada y purgada desde el cron |
| 12 | `ronda/s3-05-reservas-sin-cola` | Reservas de gasto con espera acotada e índices por fecha |
| 13 | `ronda/s3-18-jd-fija` | La descripción de una oferta que ya no la espera no cambia |
| 14 | `ronda/s3-27-tope-riesgo-modelo` | Tope del score cuando el modelo informa instrucciones en el aviso |
| 15 | `ronda/s3-14-rls-espera-acotada` | Políticas aplicadas con espera acotada y reintento |
| 16 | `ronda/s3-08-veredicto-estricto` | Veredicto de autenticación estricto y «procesar igual» |
| 17 | `ronda/s3-p2-csp-publicas` | Test: las páginas públicas no reciben CSP con nonce |
| 18 | `ronda/s3-10-parte-reservada` | El cron y el gasto de CV respetan la parte reservada del tope global |
| 19 | `ronda/s3-25-evals-desde-main` | Los evals pagos corren solo desde `main` |
| 20 | `ronda/s3-09-cupos-separados` | Cupos de correo separados por tipo de remitente |
| 21 | `ronda/s3-28-pendientes-s1` | Tope de cuerpo por ruta y estado público sin consultar la base |
| 22 | `ronda/s3-11-cuotas-legitimas` | El correo no cuenta en el espacio de la persona; tope de respuestas |
| 23 | `ronda/s3-20-purga-correcta` | La purga respeta los pendientes y borra crudos huérfanos |
| 24 | `ronda/s3-24-permisos-detalles` | Permisos solo para tablas con RLS y registro con tiempo parejo |
| 25 | `ronda/s3-15-topes-campos` | Tope en todos los campos del aviso, en el pool y en el prompt |
| 26 | `ronda/s3-21-lector-de-modos` | Un solo lector de modos que avisa ante valores desconocidos |
| 27 | `ronda/s3-p3-consultas-calientes` | Test de consultas calientes y purga de intentos por índice |
| 28 | `ronda/s3-22-secreto-y-motivos` | Secreto del webhook recortado y motivos de error acotados |
| 29 | `ronda/s3-carril-rojo-entrada` | Más controles de correo y de entrada en el carril rojo |
| 30 | `ronda/s3-26-rotacion-con-gracia` | La rotación de direcciones avisa y deja unos días de gracia |
| 31 | `ronda/s3-cierre` | Formato, este informe y el Bloque 32 del backlog |

Además, `ronda/s2-14-prompt-evaluacion` suma un commit que deja vigente el prompt v1.3.4: la rama se puede integrar sin promover v1.4.0.

Las ramas 1, 19 y 29 tocan `.github/` y van por carril rojo; varias más tocan archivos del carril rojo.

## Pasos manuales

**Base de datos.** Migraciones nuevas de Drizzle: 0070 (índices de `llm_calls`), 0071 (índices de `raw_blobs`) y 0072 (dirección anterior en `profiles`). Archivos nuevos de `packages/db/rls/`: 0028, 0029, 0030 y 0034. `pnpm db:migrate` aplica todo. **Antes del deploy**, porque el código nuevo llama a las funciones de 0028 y 0029. Antes de aplicar 0030, esta consulta tiene que dar vacía:

```sql
select relname from pg_class
 where relnamespace = 'public'::regnamespace and relkind in ('r','p') and not relrowsecurity;
```

Los índices de 0070 y 0071 se crean sin `CONCURRENTLY`: conviene aplicarlos en un momento tranquilo.

**Variables nuevas (todas opcionales, con valor por defecto):**
- `EVALUATE_MAX_CONSECUTIVE_FAILURES` (5): fallas seguidas del proveedor antes de cortar la corrida del cron.
- `LLM_RESERVE_MAX_CONCURRENT` (3): reservas de gasto simultáneas por persona.
- `ANSWER_BANK_MAX_ROWS` (500), `ANSWER_BANK_MAX_BYTES` (2 MB), `APPLICATION_ANSWERS_MAX_ROWS` (3.000), `APPLICATION_ANSWERS_MAX_BYTES` (5 MB).
- `LOGIN_ATTEMPTS_HMAC_SECRET` (sin definir: hash de siempre). Si se define, valor aleatorio largo; los contadores de login empiezan de cero.
- `INBOUND_AUTHSERV_ID` (sin definir). **Con `INBOUND_DMARC_MODE=enforce` y sin esta variable, todo el correo queda retenido.** Antes de pasar a `enforce`, medir en modo `log` qué identificador llega.

**Al desplegar.** El cambio de cookie de sesión pide volver a entrar una vez. `/api/health` sin token responde sin consultar la base: un monitor externo tiene que mandar el token de los crons o usar `/api/cron/status`.

**GitHub.** En el entorno `evals`, limitar el despliegue a `main` y mover ahí la clave del modelo. Mientras siga como secreto del repositorio, la regla del entorno no protege nada.

## Qué quedó abierto
- La política de contenido sigue en modo informe y sin destino de reportes.
- Las migraciones de Drizzle todavía no tienen tiempo máximo de espera de locks; las de RLS sí.
- Un aviso por email cuando una cuenta entra en espera por intentos fallidos.
- `/legal/privacidad` y `/legal/terminos` podrían volver a ser estáticas si su contenido no depende del pedido.
- Algunos docs de `docs/beta/` todavía describen la respuesta anterior de `/api/health`.
- Los e2e los corre el CI al integrar. En local corrieron unitarios, tipos, lint y los tests de integración de cada ticket.
