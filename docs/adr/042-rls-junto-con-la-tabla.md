# ADR-042: Las tablas nuevas no quedan accesibles antes de su RLS

**Estado:** aceptado

## Contexto

Las migraciones de Drizzle crean las tablas y los archivos de `packages/db/rls/` aplican después sus policies. Con los privilegios por defecto del esquema, una tabla nueva quedaba accesible para el rol de la app desde que la migración terminaba hasta que corría su archivo de RLS. Cada archivo se aplicaba además por separado: si uno fallaba, los siguientes quedaban sin aplicar.

## Decisión

1. Las tablas nuevas nacen sin privilegios para la app (`rls/0027`).
2. Todos los archivos de `rls/` se aplican en una sola transacción (`applyRlsFiles`). Los permisos de `rls/0000` y las policies se vuelven visibles juntos, y un archivo que falla deshace todo el paso.
3. Toda tabla nueva con datos de personas lleva su archivo de `rls/` en el mismo PR que su migración, con `ENABLE` y `FORCE ROW LEVEL SECURITY`.

## Consecuencias

- Entre la migración de Drizzle y el final del paso de RLS, la app recibe «permiso denegado» si usa una tabla nueva. Falla cerrado y dura lo que tarda el comando.
- Una tabla nueva no se puede usar desde la app hasta que corra el paso de RLS completo.
- Los archivos de `rls/` no pueden usar sentencias que no corran dentro de una transacción, como `CREATE INDEX CONCURRENTLY`.
