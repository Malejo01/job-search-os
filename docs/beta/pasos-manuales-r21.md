# Pasos manuales de la tanda R21

Todo lo de esta lista lo hacés vos: ningún agente toca Neon ni Vercel.

## 1. RLS 0055 y 0056 (Neon)

No hay migraciones de tablas: son dos funciones nuevas y las aplica el mismo `pnpm db:migrate`, que pide escribir `si`. Revisá el SQL antes.

| Archivo | Qué hace |
|---|---|
| `packages/db/rls/0055_admin_llm_spend_board.sql` | `admin_llm_spend_board(p_days)`: gasto de IA agregado por día, tarea y modelo, con fallas y respaldos. `SECURITY DEFINER` con la barrera `app_admins`; `p_days` va de 1 a 90 |
| `packages/db/rls/0056_admin_llm_spend_anomalies.sql` | `admin_llm_spend_anomalies()`: por tarea, el gasto de 24 h y el de los 7 días anteriores. Misma barrera |

- Si la base ya tiene las RLS de la R22 (0053, 0054 y 0057), no chocan: los números son distintos y cada archivo solo crea funciones.
- Para volver atrás: `DROP FUNCTION admin_llm_spend_board(integer); DROP FUNCTION admin_llm_spend_anomalies();`.
- Para ver los datos, tu cuenta tiene que estar en `ADMIN_EMAILS` **y** en `app_admins`.

## 2. Variables nuevas (opcionales)

Ninguna hace falta: sin definirlas rige el mismo valor que hoy. Sirven para subir o bajar un tope sin tocar código. Un valor cero o inválido vuelve al valor por defecto, así que no sirve para apagar una función.

| Variable | Por defecto |
|---|---|
| `INTERVIEW_MAX_SIMULATIONS_PER_DAY` | 2 |
| `CV_CHAT_MAX_COST_USD` | 0.15 |
| `CV_CHAT_USER_DAILY_CAP_USD` | 0.3 |
| `CV_CHAT_MAX_STARTS_PER_DAY` | 5 |
| `CV_PROFILE_AGENT_MAX_READS_PER_DAY` | 3 |
| `CV_PROFILE_AGENT_MAX_FLOW_COST_USD` | 0.3 |
| `CV_PROFILE_AGENT_USER_DAILY_CAP_USD` | 0.5 |
| `CV_COACH_MAX_FLOW_COST_USD` | 0.3 |
| `IMAGE_DAILY_LIMIT` | 10 |
| `IMAGE_ATTEMPTS_DAILY_LIMIT` | 30 |
| `FEEDBACK_DAILY_LIMIT` | 10 |
| `POOL_QUEUE_MAX_PER_HOUR` | 30 |
| `POOL_QUEUE_MAX_PER_DAY` | 200 |
| `DEMO_WEEKLY_CAP_USD` | 1 |
| `EVALUATE_CRON_LIMIT` | 50 |

El equipo no puede editar `.env.example`: si querés dejarlas documentadas ahí, copiá esta tabla. También están al final de «Topes» en `docs/beta/costos.md`.

## 3. Qué mirar en la app

1. **`/settings/costos`** (Ajustes → «Costos de IA»):
   - el resumen con la proyección del mes y su color;
   - las tablas por día, por tarea y por modelo;
   - el costo por unidad;
   - la calculadora. Cargá el tipo de cambio del día: el de referencia está desactualizado.
2. **`/settings/salud`**: el bloque «Gasto de IA fuera de lo normal». Con poco uso va a decir «Sin anomalías».
3. **`/interview`**: el texto dice «hasta 2 simulaciones por día», o el número que pongas en la variable.

## 4. e2e que corren solo con variables

| Spec | Qué necesita |
|---|---|
| 109 Salud (bloque de anomalías) y 170 Costos | `ADMIN_EMAILS` y el usuario del seed |

Con la base sembrada: `pnpm e2e:local 109 170`.

## 5. Integración

Alcanza con `ronda/r21-cierre`, que sale de `main` actual. Es carril rojo: el PR lo mergeás vos.
