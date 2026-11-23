# Informe de la tanda S5 «Seguridad corta» (22/11)

Arreglos chicos de robustez en el correo entrante, el control de gasto y el MCP. Además deja preparadas tres propuestas para aplicar a mano: dependencias de desarrollo, la carpeta privada fuera del repo y consultas locales solo con agregados.

Ningún agente llamó a un modelo (USD 0), tocó Neon, Vercel ni GitHub, instaló dependencias ni mergeó nada. El detalle de cada hallazgo vive fuera del repo.

Base: `origin/main` en 8e3ebab, con la S4 y la R17. Es independiente de la R19: las dos se integran por separado.

## Cómo están armadas las ramas

Una sola cadena: cada rama apunta al último commit de su ticket y contiene las anteriores. Se integran en este orden, o alcanza con la última (`ronda/s5-cierre`).

| # | Rama | Qué hace |
|---|---|---|
| 1 | `ronda/s5-04-costo-fallidas` | El tope de gasto de la corrida cuenta las evaluaciones fallidas; el límite de imágenes no cuenta los intentos sin proveedor disponible |
| 2 | `ronda/s5-02-cupo-antes-del-cuerpo` | Con el cupo de no esperados lleno, un remitente con emails ilegibles se rechaza antes de pedir el cuerpo |
| 3 | `ronda/s5-05-tope-mcp` | Guardar respuestas por MCP tiene un tope total que entra en el tope del cuerpo; mensajes de error claros |
| 4 | `ronda/s5-06-carpeta-privada` | `JSO_PRIVATE_DIR`: los datos privados pueden vivir fuera del repo; sin la variable, todo igual |
| 5 | `ronda/s5-03-rechazos-una-vez` | El contador de rechazados no suma reintentos de emails provisionales ni emails guardados |
| 6 | `ronda/s5-cierre` | Backlog, este informe y los pasos manuales |

**Al integrar con la R19:**
- Chocan `docs/BACKLOG.md` (bloques 35 y 36) y `packages/adapters/src/inbound/handle.ts`. La R19 suma la lectura del pool y la S5 cambia el orden del cupo y del cuerpo, en otra parte del archivo.
- Puede chocar también `packages/adapters/src/index.ts`.
- Casi todas las ramas son del carril rojo: correo entrante, MCP, worker y scripts.

## Verificación
- Cada arreglo tiene un test que reproduce el caso. Corrió primero en rojo y después en verde, y el lead volvió a correr los tests de cada ticket:
  - correo entrante: 9 archivos de integración;
  - gasto: 7 de integración, más 31 de los vecinos;
  - MCP: 8 + 6;
  - carpeta privada: 17, más el test que exige que el barrido falle sin patrones.
- Typecheck en 0 errores en db, adapters y web. Eslint y prettier limpios en los archivos tocados.
- Siguen fallando en Windows tres tests de enlaces simbólicos del barrido de privacidad, por permisos. Ya fallaban antes de esta tanda.

## Decisiones
- **Errores de Resend:** se reintentan como hasta ahora; Svix espera cada vez más entre intentos. Se descartó dejarlos pendientes con espera, porque eso terminaba con el email legítimo en la cola manual y sin cuerpo.
- **Contador de rechazados:** sin migración. Los rechazos por cupo de un email que no deja fila siguen sumando por entrega. Contarlos una sola vez exige guardar el identificador del email, y queda diseñado para más adelante.
- **MCP:** se bajó el máximo del esquema en lugar de subir el tope del cuerpo, para no leer más antes de autenticar.
- **`JSO_PRIVATE_DIR`:** si es relativa o no existe, da error. Así un error de tipeo no puede cargar otros datos sin avisar.

## Rendimiento
- Ninguna página suma consultas ni cambia de tamaño.
- **Correo:** suma un conteo por índice por email, y una segunda consulta solo cuando el cupo de no esperados está lleno.
- **Worker:** relee el gasto solo cuando una evaluación falla, con la misma consulta por índice que ya se verificaba y acotada por el corte a las 5 fallas seguidas.

## Migraciones y variables
- Sin migraciones.
- Variable opcional `JSO_PRIVATE_DIR`: sin ella, todo sigue igual que hoy.

## Pasos manuales
Ver [`pasos-manuales-s5.md`](pasos-manuales-s5.md).
