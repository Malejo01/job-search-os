# Mover los datos privados fuera del repo

Hoy `.env.local` y `fixtures-private/` viven dentro de la carpeta del repo. Con esta guía los movés a una carpeta aparte (`C:\Programacion\jso-privado\`) y le avisás al código dónde están con la variable `JSO_PRIVATE_DIR`. Sin la variable todo funciona como siempre, así que el cambio se puede hacer y deshacer sin riesgo.

## Cómo queda

```
C:\Programacion\jso-privado\
  .env.local
  fixtures-private\
    (lo mismo que hoy: golden, perfil, patrones de privacidad, etc.)
```

Qué lee de ahí:

| Qué | Quién |
| --- | --- |
| `.env.local` | `loadLocalEnv()` (base, scripts, workers y `next.config.ts` de la web) |
| `fixtures-private/*.json` | seed y evals (`loadFixture`), `applicant:sync` |
| patrones de privacidad | `privacy-scan`, `inbound:skeleton`, `scripts/anonymize.mjs` |

Reglas de la variable (falla cerrado, para que un error de tipeo no cargue otros datos en silencio):

- Sin definir o vacía: se usa la raíz del repo, como hoy.
- Definida: tiene que ser una ruta **absoluta** y una **carpeta que existe**. Si no, el comando se corta con un mensaje que nombra la variable (sin imprimir la ruta).
- Con la variable definida, **no** se cae a la copia del repo: si un archivo no está en la carpeta externa, se usa el de ejemplo (fixtures) o el comando falla (patrones de privacidad).

## Pasos

1. **Cerrá** todo lo que use el repo: terminales, VS Code, `pnpm dev` si estaba corriendo.
2. Creá la carpeta `C:\Programacion\jso-privado\` y **copiá** (no muevas todavía) `.env.local` y `fixtures-private\` desde la raíz del repo. Si en `apps\web\` hay un `.env.local` propio, no lo toques: es otro archivo y Next lo lee solo.
3. Definí la variable para tu usuario de Windows. En una terminal:

   ```
   setx JSO_PRIVATE_DIR "C:\Programacion\jso-privado"
   ```

   `setx` solo vale para terminales nuevas: **cerrá y volvé a abrir VS Code** (o la terminal) para que la tome. Verificá con `echo %JSO_PRIVATE_DIR%` (cmd) o `$env:JSO_PRIVATE_DIR` (PowerShell).
4. **Verificá**, en una terminal nueva, desde la raíz del repo:
   - Privacidad: `node .claude/bin/privacy-scan.mjs --tree` tiene que correr sin hallazgos y sin el mensaje «No hay patrones». Si dice «JSO_PRIVATE_DIR…», la ruta está mal escrita o no existe.
   - Código: `pnpm --filter @job-search-os/db exec vitest run src/private-dir.test.ts src/fixtures.test.ts`.
   - Base local (con Docker abierto): `node .claude/bin/local.mjs migrate` o `pnpm db:seed:local` y mirá la línea «datos del usuario: …»: tiene que decir que usa `fixtures-private/ (reales)`.
5. Si todo da bien, **borrá** el `.env.local` y la carpeta `fixtures-private\` de la raíz del repo (los de adentro del repo, no los de `jso-privado`). Volvé a correr el paso 4 para confirmar que sigue andando con la copia externa.
6. Si usás worktrees con una junction a `fixtures-private`, ya no hace falta: sacala (borrá la junction antes que el worktree) y heredan la variable del usuario.

## La web (Next)

`apps/web/next.config.ts` ya llama a `loadLocalEnv()`, así que lee el `.env.local` externo cuando arrancás con `node .claude/bin/local.mjs dev`, siempre que la terminal tenga la variable. Next además lee por su cuenta archivos `.env*` de `apps\web\`: esos no se redirigen. Si tenés uno ahí con secretos, movelo a la carpeta externa y dejá solo lo que no sea sensible.

## Verificá que el pre-push y `pr.mjs` siguen encontrando los patrones

El barrido **falla** (código distinto de 0 y el mensaje «No hay patrones en …») si la carpeta de patrones no existe o no tiene `empresas.map.json` o `privacy-patterns.txt`: nunca termina «sin hallazgos» por no tener patrones. Eso hay que comprobarlo después de mover, en una terminal nueva (con la variable):

1. `node .claude/bin/privacy-scan.mjs --tree`: tiene que correr el barrido completo y terminar con 0 o con hallazgos reales, nunca con «No hay patrones».
2. `node .claude/bin/privacy-scan.mjs --self-test`: confirma que los patrones cargados detectan algo.
3. Pre-push: hacé un push de prueba a una rama `ronda/...` y mirá que el hook imprima el barrido y no «No hay patrones». Ojo: el hook de git corre con el entorno de quien hace el push; si empujás desde una terminal que no tiene la variable, usa la raíz del repo y, ya sin `fixtures-private` ahí, **bloquea el push** (falla cerrado). Si pasa, abrí la terminal nueva o definí la variable.
4. `pr.mjs`: corré `node .claude/bin/pr.mjs` sobre un PR en borrador de prueba, o al menos mirá que no diga «No hay patrones de privacidad». Necesita que `.claude/bin/privacy-scan.mjs` tenga la propuesta aplicada (default por `JSO_PRIVATE_DIR`); si no, sigue buscando en la raíz del repo y frena.
5. Prueba de que frena: en una terminal con `JSO_PRIVATE_DIR` apuntando a una carpeta vacía (`set JSO_PRIVATE_DIR=C:\Programacion\vacia` con la carpeta creada), `node .claude/bin/privacy-scan.mjs --tree` tiene que terminar con código 2.

## Verificá que no quedó nada atrás

- `git status` no debe mostrar nada nuevo (ambos nombres siguen en `.gitignore`).
- `dir` de la raíz del repo no debería listar `.env.local` ni `fixtures-private`.

## Cómo volver atrás

1. Copiá `.env.local` y `fixtures-private\` de `C:\Programacion\jso-privado\` a la raíz del repo.
2. Quitá la variable del usuario: `reg delete HKCU\Environment /v JSO_PRIVATE_DIR /f` y reabrí la terminal. (Dejarla vacía también alcanza: vacía equivale a no definida.)
3. Corré de nuevo el paso 4 sin variable.

## Qué NO cambia

- Producción (Vercel, Neon): no usa la variable ni tiene esos archivos; las variables vienen del entorno.
- Los tests con carpetas temporales: no dependen de tu variable.
