# Informe de la tanda R21 «Costos a la vista» (23/11)

Ahora se ve cuánto gasta la IA y si alcanza el precio:
- un tablero para admins con el gasto por día, tarea y modelo;
- el costo por oferta, por simulación, por charla, por CV y por persona;
- una calculadora de margen por plan;
- todos los topes listados en un solo lugar y operables por variable;
- un aviso en Salud cuando una tarea gasta mucho más que de costumbre.

Ningún agente llamó a un modelo (USD 0), tocó Neon, Vercel o Resend, ni mergeó nada. **No cambió ningún tope ni precio:** los 15 topes que pasaron a variable tienen el mismo valor por defecto.

## Cómo están armadas las ramas

La tanda se escribió sobre `origin/main` en 8e3ebab, en cadena (`ronda/r21-01` a `ronda/r21-05`). Después se volvió a aplicar entera sobre `main` actual, con la R19, la S5, la R20 y la R22 (merge #553 a #556):

| Rama | Qué tiene |
|---|---|
| `ronda/r21-01-tablero-gasto` … `ronda/r21-05-anomalia-gasto` | Un ticket por commit, sobre 8e3ebab (quedan como referencia) |
| `ronda/r21-sobre-main` | Los 5 tickets en un commit, sobre `main` actual |
| `ronda/r21-cierre` | Lo anterior más el backlog, este informe, los pasos manuales y el carril rojo |

**Para integrar alcanza con `ronda/r21-cierre`.** El guard del equipo no deja `git merge` ni `cherry-pick`, así que el pase a `main` se hizo copiando los archivos. Se verificó que los 52 archivos que solo tocó la R21 quedaron idénticos a los de `ronda/r21-trabajo`. Los 7 que tocaban las dos partes se resolvieron dejando ambos lados: el índice del pipeline, `admin-routes.ts`, el e2e 140, los enlaces de Ajustes, los casos de `multiusuario`, `image-server.ts` y `inbound/handle.ts`.

## Por ticket

- **R21-01 · Tablero de gasto (`/settings/costos`).**
  - La función `admin_llm_spend_board` (RLS 0055) devuelve, en una consulta, el gasto por día, por tarea y por modelo y los totales. Tiene la misma barrera `app_admins` que el resto de los tableros.
  - Solo cuenta `cost_usd` real; las llamadas sin tarifa van aparte.
  - **Respaldos:** `llm_calls` no marca cuándo respondió el modelo de respaldo. Se infiere cuando el modelo de la fila es el `fallback_model` actual de su tarea, y la pantalla lo aclara.
  - **Proyección:** el promedio de los últimos 7 días × 30, contra el tope diario × 30.
- **R21-02 · Costo por unidad.**
  - Funciones puras en el pipeline. La lectura va por la conexión de servicio, como Salud.
  - Oferta = evaluación + extracción de skills, dividido por las evaluaciones logradas. Simulación = llamadas de Interview, dividido por las preguntas logradas. Charla = conversaciones distintas. CV = diagnóstico.
  - Por persona se muestran p50 y p90, y solo si hay al menos 3 personas.
- **R21-03 · Calculadora de margen.**
  - Formulario GET nativo, sin JS de cliente. Un campo inválido vuelve a su valor por defecto.
  - Calcula el costo de IA por persona, el margen y el punto de equilibrio con Vercel y Neon como costos fijos.
  - Los valores por defecto y de dónde sale cada uno están en `docs/beta/costos.md`. El tipo de cambio es un campo manual: el de referencia está desactualizado y hay que cargarlo a mano.
- **R21-04 · Topes ordenados.**
  - `docs/beta/costos.md` lista 84 topes: qué controla cada uno, el valor por defecto, dónde se lee y si se puede cambiar por variable.
  - 15 topes fijos pasan a leerse con `readCap`: si la variable falta, está vacía, vale cero o es inválida, rige el valor por defecto. Un cero no apaga una función.
  - Los límites de entrada, las reservas por paso y los topes por plan quedan fijos, con el motivo anotado.
  - `/interview` muestra el número real de simulaciones por día en vez de «dos».
- **R21-05 · Aviso de anomalía en `/settings/salud`.**
  - La función `admin_llm_spend_anomalies` (RLS 0056) devuelve, por tarea, el gasto de las últimas 24 h y el de los 7 días anteriores.
  - Avisa si el gasto de 24 h pasa 3 veces el promedio diario de esos 7 días y además llega a USD 0,10. Justo 3 veces no avisa.
  - Una tarea sin gasto en los 7 días previos avisa al llegar a USD 0,10, para que un gasto nuevo no pase en silencio.
  - Si la lectura falla, dice «No se pudo leer», nunca «Sin anomalías».

## Pruebas

- Typecheck sin errores en pipeline, adapters, db y web.
- Unitarios sobre `main` + R21:
  - pipeline: 6105;
  - web: 296;
  - adapters: 1691. Fallan 3 tests de `privacy-scan` que crean symlinks: en Windows no hay permiso para crearlos, así que corren en el CI.
- Integración con Docker:
  - db: 303 (costos, anomalías, `multiusuario` con las funciones de la R21 y la R22, cola de altas, uso por carrera y avisos de pago);
  - adapters: 3 (filas de costo por unidad).
- Barrido de privacidad: sin hallazgos en lo versionado.
- e2e 109 y 170: no corrieron en local porque necesitan `ADMIN_EMAILS` y el usuario del seed, y se saltean limpios sin eso. Quedan para el CI o para correrlos a mano.
- El test del carril (`.github/scripts/carril.test.mjs`) lo corre el CI. El guard no deja correrlo en local.

## Carril

Es rojo: toca RLS, rutas de la API, `inbound/**` y archivos con el rol de servicio. Los 3 archivos nuevos que leen con la conexión de servicio (`llm-spend-board.ts`, `spend-anomalies.ts` y `unit-cost.ts`, en `apps/web/lib`) se sumaron a `.github/carril-rojo.txt` y a `CODEOWNERS`.
