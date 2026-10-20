# Carril verde: merge automático con barreras

Ronda 65. **Viene apagado:** no hace nada hasta que Mauro toque los settings de la sección "Settings de GitHub que toca Mauro". Mientras tanto, todo se mergea como hoy, a mano.

## Para qué

Mauro deja de ser el cuello de botella en los PR chicos y de bajo riesgo: texto de UI, componentes, tests, docs. Lo que puede romper datos, seguridad, costos o temas legales sigue pasando por sus manos.

## Cómo funciona

1. El lead abre el PR en draft, como siempre.
2. Si el PR **no** toca nada del carril rojo y ya tiene **PASA de privacidad y del revisor** (y de seguridad, si la ronda la tuvo), el lead hace tres cosas:
   - lo marca listo;
   - le pone la etiqueta `carril-verde`;
   - activa el auto-merge con squash.

   Todo lo que entra a `main` corre con los secretos de producción en Vercel: el carril verde no reemplaza esas revisiones, se apoya en ellas.
3. Dos barreras independientes separan lo verde de lo rojo:
   - **`CODEOWNERS`** (`.github/CODEOWNERS`). Los paths rojos tienen a Mauro como code owner. Con "Require review from Code Owners", un PR que toca alguno necesita su aprobación. El lead no la puede dar: abre los PR con la cuenta de Mauro, y nadie aprueba sus propios PR. Esto lo impone GitHub y no depende de ningún workflow.
   - **El check `carril`** (`.github/workflows/carril.yml`). Pasa solo si se cumple todo esto:
     - el PR tiene la etiqueta `carril-verde`;
     - viene de una rama de este repo, no de un fork;
     - la variable `AUTO_MERGE_PAUSED` no es `true`;
     - no toca ningún path de `.github/carril-rojo.txt`. La misma lista de `CODEOWNERS`; un test verifica que coincidan.

     Falla cerrado en estos casos:
     - la lista de archivos de la API no coincide con `changed_files`;
     - el PR llega al tope de 3000 archivos;
     - la punta del PR cambió durante el chequeo.

     Los nombres anteriores de los archivos renombrados también cuentan.
4. Con `carril` y el CI (`secrets`, `lint-typecheck`, `unit`, `integration`, `build` y `e2e`) en verde, GitHub mergea solo. Cada push nuevo vuelve a correr todo.
5. Vercel deploya `main`. Después, `smoke.yml` corre el smoke de solo lectura con la cuenta de prueba.
   - **Si falla, abre un issue** con la etiqueta `smoke-roto`, o comenta el que ya esté abierto, y GitHub le avisa a Mauro.
   - El rollback está en la sección "Si el smoke falla: rollback".

**Un PR del carril rojo** no pasa ninguna de las dos barreras. Lo mergea Mauro desde la web con "Merge without waiting for requirements to be met": es admin y tiene bypass en el ruleset.

### Por qué `pull_request_target`

Con `pull_request`, GitHub corre el workflow **de la rama del PR**. Un PR que edite `carril.yml` podría hacer que el check pase siempre. Con `pull_request_target`, el workflow, el script y la lista roja salen siempre de `main`.

- El código del PR no se descarga ni se ejecuta: el checkout es de `main` y solo de `.github/`.
- El token tiene permisos de lectura y nada más.
- Por lo mismo, `carril` no corre en el PR que lo introduce: empieza a valer cuando está en `main`.
- El script tiene tests (`node --test .github/scripts/carril.test.mjs`) que corren en el job `lint-typecheck`.

**Límite conocido:** un PR podría agregar otro workflow con un job que también se llame `carril` y que siempre pase. Por eso `CODEOWNERS` es la barrera principal: ese PR toca `.github/**`, así que es rojo y necesita la aprobación de Mauro igual.

## Carril rojo

La lista vive en `.github/carril-rojo.txt` y se repite en `.github/CODEOWNERS`. Se edita con un PR, que también es rojo porque toca `.github/**`. Hoy incluye:

- **Base de datos:**
  - migraciones, `schema.ts`, RLS y seeds;
  - todo `packages/db/src/**`, con la conexión, la guarda de producción y los scripts;
  - `docs/sql/**` (roles).
- **CI y controles:**
  - `.github/**` y `scripts/**`, que incluye el barrido de privacidad;
  - `infra/**`;
  - `.gitignore`, la configuración de lint, TypeScript, Vitest, Playwright y Turbo;
  - `CLAUDE.md` y `.env.example`.
- **Sesión y autorización:**
  - auth, middleware, `instrumentation.ts`, sesión y `lib/db.ts`;
  - **todos los `actions.ts`**, porque cada server action verifica la sesión;
  - los `lib/` que arman el alcance por usuario;
  - los adapters de auth y admin.
- **Evaluador:**
  - prompts y `evals/**`, cuyo CI es pago;
  - `decide.ts`, que contiene los `adjustments`;
  - `evaluation.ts`, `evaluator/**` y `prefilter/**`;
  - el worker, la cola, el applicant y los adapters de LLM.
- **Legales y datos personales:** legales, borrado de cuenta, retención, privacidad y storage.
- **Bordes con secreto propio:**
  - **todas** las rutas de `app/api/**`;
  - el webhook y los parsers de email;
  - el envío de email y el MCP.
- **Dependencias y build:** **cualquier** `package.json`, el lockfile, `pnpm-workspace.yaml`, `.npmrc`, `next.config.ts` y `vercel.json`.

> **Diferencia con el pedido:** el pedido decía "`package.json` cuando cambian dependencias". Acá cuenta **cualquier** cambio en un `package.json`, porque los `scripts` también pueden ejecutar código en el CI. Es más simple de verificar y más estricto.

## Pausar

- **Pausa (la que vale): destildá Settings → General → "Allow auto-merge".** GitHub desactiva el auto-merge de los PR que lo tenían activado. Usala en ensayos y demos.
- **Señal adicional:** la variable `AUTO_MERGE_PAUSED=true`, en Settings → Secrets and variables → Actions → Variables.
  - Hace fallar las corridas **nuevas** de `carril`.
  - Un PR que ya tenía `carril` en verde **no** se vuelve a evaluar solo. Por eso no alcanza sola.
- **Freno de emergencia sobre un PR puntual:** `gh pr merge <n> --disable-auto`, o el botón "Disable auto-merge" en el PR.
- **Para reanudar:**
  1. Volvé a tildar "Allow auto-merge".
  2. Borrá la variable o ponela en `false`.
  3. En cada PR, el lead vuelve a activar el auto-merge, y hay que quitar y poner la etiqueta para que `carril` corra de nuevo.

## Si el smoke falla: rollback

Hasta que el #102 esté mergeado, esto vive acá. Después va a `docs/OPERACION.md`.

1. El issue `smoke-roto` trae el link a la corrida. Mirá qué flujo falló.
2. **Volvé atrás ya, sin esperar el diagnóstico:**
   - entrá a Vercel → proyecto → Deployments;
   - buscá el último deploy de Production que estaba bien: el anterior al merge, marcado "Current" antes del merge;
   - abrí su menú `⋯` y elegí **Instant Rollback**.

   No hace build y en segundos sirve la versión anterior.
3. Pausá el carril.
4. Con un rollback activo, Vercel **no promueve** los deploys nuevos de `main` hasta que lo deshagas. Arreglá en un PR, y cuando el fix esté en `main`, entrá a Deployments → el deploy nuevo → **Promote to Production**.
5. Cerrá el issue con el link al PR del arreglo.

> **Ojo con las migraciones.** El rollback de Vercel no deshace migraciones de Neon. Un PR con migración es carril rojo y lo mergea Mauro, que antes aplica la migración. Si hay que volver atrás, la migración tiene que ser compatible con el código anterior.

## Settings de GitHub que toca Mauro

En este orden, después de copiar los archivos de `.github/` y `docs/` a `main`:

1. **Etiquetas.** Issues → Labels → New label: `carril-verde`, color verde. Creá también `smoke-roto`, en rojo. Si no existe, el smoke la crea solo la primera vez que falla.
2. **Auto-merge.** Settings → General → Pull Requests:
   - tildá **Allow auto-merge**;
   - dejá tildado **Allow squash merging**;
   - opcional: tildá **Automatically delete head branches**.
3. **Ruleset de `main`:** Settings → Rules → Rulesets → New branch ruleset.
   - Name `main`, Enforcement **Active** y Target "Default branch".
   - **Bypass list:** Repository admin, en modo "For pull requests only". Así Mauro mergea los PR rojos.
   - Tildá **Restrict deletions** y **Block force pushes**.
   - **Require a pull request before merging:**
     - aprobaciones requeridas: 0. Los PR verdes no piden revisión; los rojos la piden por code owner;
     - **tildá "Require review from Code Owners"**;
     - tildá "Require conversation resolution";
     - en "Allowed merge methods", dejá **Squash**. Si querés seguir usando merge commits en los rojos, dejá también Merge.
   - **Require status checks to pass:**
     - agregá `carril`, `secrets`, `lint-typecheck`, `unit`, `integration`, `build` y `e2e`;
     - en cada uno, si la UI lo ofrece, elegí la fuente "GitHub Actions";
     - **no** agregues `evals`, porque se saltea en la mayoría de los PR;
     - destildá "Require branches to be up to date": con el squash no hace falta, y obligaría a actualizar cada PR.
4. **Variable de pausa.** Settings → Secrets and variables → Actions → Variables: `AUTO_MERGE_PAUSED` = `false`. Es opcional.
5. **Permisos del token.** Settings → Actions → General → Workflow permissions:
   - elegí "Read repository contents and packages permissions";
   - destildá "Allow GitHub Actions to create and approve pull requests".

   Cada workflow pide lo que necesita: `carril` lee los PR, `secrets` lee los commits del PR y `smoke` escribe issues.
6. **Pruebas, antes de habilitar al lead.** Con PR de prueba triviales (un typo en un doc):
   1. **Verde:** etiqueta y auto-merge → tiene que mergear solo cuando termina el CI.
   2. **Rojo por dependencia:** un PR que toca `package.json`, con etiqueta y auto-merge → `carril` falla, pide revisión de code owner y **no** se mergea.
   3. **Check falsificado:** un PR que agrega `.github/workflows/x.yml` con un job llamado `carril` que hace `echo ok`, con etiqueta y auto-merge → **no** se tiene que mergear, porque es rojo por `CODEOWNERS`. Cerralo sin mergear.
   4. **Etiqueta quitada:** en un PR verde con `carril` ya en verde, quitá la etiqueta → `carril` vuelve a correr y falla; el auto-merge tiene que quedar esperando.
   5. **Bypass del admin:** las pruebas 2 y 3 importan porque el `gh` del lead usa tu cuenta, que es admin y tiene bypass. Si alguno de esos PR se mergea igual, sacá el bypass del ruleset y avisá: rojo y verde no estarían separados. Para mergear los rojos usarías entonces "Edit ruleset" → enforcement "Disabled" por un momento.

   A mediano plazo, lo más sólido es que el lead tenga **su propia cuenta de GitHub** (machine user) con rol write y sin bypass. Así GitHub impone todo, y la aprobación de code owner la da Mauro de verdad.

## Qué habilita esto para el lead

Necesita que Mauro edite la configuración local del equipo de agentes (el guard de comandos y sus reglas). El lead no la toca: deja la propuesta escrita.

- Solo puede usar:
  - `gh pr ready <n>`;
  - `gh pr edit <n> --add-label carril-verde`;
  - `gh pr merge <n> --auto --squash`;
  - `gh pr merge <n> --disable-auto`, el freno.

  Siempre sobre PR de ronda propios.
- Nunca `--admin`, `--merge` ni `--rebase`. Nunca sobre un PR que toque el carril rojo: las barreras lo frenan igual, pero el lead tampoco lo intenta.
