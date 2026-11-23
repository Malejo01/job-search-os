# Pasos manuales de la tanda S5 «Seguridad corta» (22/11)

Ninguno lo hace un agente. Esta tanda no tiene migraciones ni variables obligatorias.

## 1. Dependencias de desarrollo con parches pendientes (lo aplica Claude al integrar)
Son solo dependencias de desarrollo: ninguna llega al bundle ni a producción. La propuesta (un diff de `pnpm-workspace.yaml`, donde pnpm 11 declara los `overrides`) y los comandos para verificarla están en la carpeta privada de la tanda, en `ops/`. Quien la aplique corre primero `pnpm audit` como línea de base, aplica el diff, corre `pnpm install` para regenerar el lockfile y después la verificación completa (audit, tipos, tests, build e integración).

## 2. Mover los datos privados fuera del repo (opcional)
Guía completa en [`docs/seguridad/mover-privados.md`](../seguridad/mover-privados.md). En resumen:
1. Mové `.env.local` y `fixtures-private/` a `C:\Programacion\jso-privado\`.
2. Definí la variable de usuario de Windows `JSO_PRIVATE_DIR` con esa ruta absoluta.
3. Abrí una terminal nueva y verificá con el barrido de privacidad. Si la carpeta no tiene los patrones, tiene que terminar con código 2, nunca «sin hallazgos».

Antes de mover la carpeta, aplicá las dos propuestas que dependen de esta variable (están en la carpeta de la tanda, en `ops/`): la del barrido de privacidad de `.claude/bin/` y la de `evals/`, que aplica Claude.

Sin esas dos, `pr.mjs` y los evals siguen buscando los datos en la ruta de siempre. El pre-push usa el entorno de la terminal desde la que empujás: si en esa terminal no está la variable, el push queda bloqueado (falla cerrado).

Sin la variable, todo sigue funcionando como hoy.

## 3. Consultas locales solo con agregados (propuesta en `.claude/`)
La propuesta (el script completo, su batería de casos, el comando para probarla y los pasos para aplicarla y volver atrás) está en la carpeta de la tanda, en `ops/`.

1. Cerrá las sesiones de Claude Code sobre el repo.
2. Corré la batería: tiene que pasar entera.
3. Hacé el respaldo y copiá los archivos como dicen los pasos de la propuesta.
4. Contra el snapshot solo se aceptan consultas de agregados sobre una lista corta de columnas de metadatos. Sumar una columna a esa lista es decisión tuya.
5. Contra la base de desarrollo, con datos ficticios, rigen los filtros de siempre.

## 4. Qué cambia en producción al mergear
- **Correo entrante:** con el cupo de no esperados lleno, un remitente que ya mandó emails ilegibles se rechaza antes de pedir el cuerpo. El contador de rechazados ya no suma los reintentos que retoman un email provisional ni los emails guardados por el tope de almacenamiento.
- **Gasto:** cuando una evaluación falla, el worker vuelve a leer el gasto real de la base, así el tope de la corrida también cuenta las fallidas. El límite diario de imágenes ya no cuenta los intentos con el proveedor principal sin clave.
- **MCP:** guardar respuestas acepta hasta 60.000 caracteres por llamada. Si se pasa, el error pide guardarlas en varias llamadas.
