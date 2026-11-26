Tanda R32 «Inventario y alta». Armá un **EQUIPO DE AGENTES** con 3 teammates y vos como lead. Mecánica, reglas y cierre: `docs/beta/cadena-r30-r34.md`. Especificación: `docs/beta/plan-r30-r34.md` (secciones 10 y 14).

- Ramas `ronda/r32-NN-<nombre>`. e2e: 390 a 409. Bloque 50 del BACKLOG.
- **Base:** `origin/ronda/r31-integracion` si existe; si no, `origin/ronda/r31-cierre`.

**Por qué esta tanda:** de los avisos vigentes del pool, muy pocos están en español o aceptan gente de Argentina, y varias de las 8 carreras de la beta tienen menos de 10. Una persona que entra y ve tres ofertas no vuelve. Acá se arma lo que hace falta para sumar inventario local y para abrir cada carrera recién cuando tenga con qué.

## Reglas propias de esta tanda

- **Ningún modelo.**
- **Ningún pedido a un portal ni a una API de empleo.** Todo se prueba con fixtures públicas, con empresas y títulos inventados. Lo que haya que probar contra el servicio real va a los pasos manuales, con `--dry-run`.
- **La app no crea alertas ni navega portales** (ADR-004). Las alertas las arma cada persona por su cuenta. La app explica cómo y lee los emails que le reenvían.
- **Los lectores de email fallan cerrado:** si la estructura no es la esperada, el email entero va a la cola manual.
- **Nada abre solo.** El panel informa y el responsable decide.
- **Cada fuente, detrás de su variable,** apagada por defecto.
- **No cambies `BETA_OPENS_AT` ni `BETA_FECHA_DEFINITIVA`.** La fecha la pone el responsable.

## Equipo y tickets

| Teammate | Tickets en orden |
|---|---|
| **alta** | R32-01 → R32-03 → R32-04 → R32-09 |
| **fuentes** | R32-05 → R32-06 → R32-07 → R32-08 |
| **cobertura** | R32-02 |

`cobertura` define primero, en `packages/pipeline`, qué es una oferta **vigente** y qué es **tomable:** `alta` las usa en R32-03 y R32-04. El lead hace R32-10 al final.

### R32-01 · Carrera obligatoria

- En el alta, la carrera es un paso obligatorio, con las carreras de la beta y «Otra» con texto libre.
- Quien ya tiene cuenta y no la cargó la ve pedida una sola vez al entrar, sin perder lo que estaba haciendo.
- Revisá el onboarding, `career-names.ts` y `career-visibility.ts` antes.

### R32-02 · Panel de cobertura

- **Reglas en `packages/pipeline`,** con tests primero. Revisá `pool/coverage.ts` y `pool/location-scope.ts`:
  - **vigente:** la fuente la mostró en los últimos 7 días;
  - **tomable:** el aviso acepta Argentina, su región o todo el mundo de forma explícita, o el lugar de trabajo está en Argentina. Si no dice países, no cuenta;
  - **para quien empieza:** la misma señal del chip «Para empezar» de la R30.
- **`/admin/cobertura`:** por carrera, cuántas vigentes, cuántas tomables, cuántas para quien empieza, cuántas en español y de qué fuentes vienen.
  - Semáforo contra el umbral: 30 tomables y 10 para quien empieza.
  - La tendencia de los últimos 14 días, si los datos alcanzan.
- Una sola consulta por bloque, con índice. Medí el tiempo con los datos sembrados.
- La checklist de `/admin/apertura` lee este estado, carrera por carrera.

### R32-03 · Apertura por carrera

- **Una lista de carreras abiertas,** que el responsable cambia desde el admin. Queda en el historial quién la cambió y cuándo. Revisá `apps/web/lib/apertura.ts` y `packages/pipeline/src/plan-access.ts`.
- **Quien se anota de una carrera que todavía no abrió** ve: «Todavía estamos sumando ofertas de {carrera}. Te avisamos por email apenas abra». Queda en la lista de espera con su carrera.
- **Quien ya está adentro no pierde nada** si su carrera no figura como abierta.
- Reglas en `packages/pipeline`, con tests: carrera abierta, cerrada, «Otra» y cuenta anterior.

### R32-04 · Pocas ofertas y guía de alertas

- **Estado vacío por carrera:** cuando una persona tiene pocas ofertas, la pantalla lo dice sin vueltas y le ofrece el paso siguiente. Revisá `alerts/few-offers.ts`, `alerts/nudge-copy.ts` y `jobs/email-nudge.tsx`.
- **Guía de alertas,** paso a paso y por carrera. Revisá `alerts/portal-guide.ts`:
  - qué portales conviene según la carrera, con las palabras de búsqueda sugeridas;
  - cómo crear la alerta en cada uno;
  - cómo hacer que esos emails lleguen a su dirección de AfinIA Jobs.
- La persona ve cuántas ofertas le llegaron por cada alerta, para saber cuál le sirve.
- Los textos van a `textos-rediseno.ts`.

### R32-05 · Fuentes listas para prender

- **Jooble (ADR-039) y ReliefWeb (ADR-028):** revisá que cada adaptador esté completo, con tests sobre fixtures públicas, tope de pedidos, atribución de la fuente y su variable. En los pasos manuales: cómo se pide cada clave y cómo se prueba con `--dry-run`.
- **Computrabajo (ADR-043):** revisá el lector de alertas con fixtures públicas derivadas a mano. Falla cerrado. Anotá qué carreras cubre mejor.
- Por cada fuente, una línea en `docs/sources/` con qué trae, en qué idioma y para qué carreras.

### R32-06 · Empresas regionales

- Para los adaptadores que ya existen (Greenhouse, Lever, Ashby, Workable, Teamtailor), una lista propuesta de empresas que contratan en Argentina o en la región, ordenada por carrera de la beta.
- La propuesta va a `ops/rondas/r32-tanda/R32-06/propuesta/`, con el formato del seed de boards. **No se verifica contra los sitios:** eso va a los pasos manuales, con `pool:fetch --dry-run`.
- Los adaptadores que la R28 dejó apagados siguen apagados.

### R32-07 · Lector de Get on Board

- Hay emails de Get on Board que terminan con error. Revisá el lector con las variantes que se puedan armar de forma pública: una oferta, varias, sin sueldo y con el HTML cambiado.
- Que el motivo del error quede claro en la cola manual, para arreglarlo rápido la próxima vez.
- Los emails reales no se leen. En los pasos manuales va cómo revisa el responsable los que fallaron.

### R32-08 · Sueldo en la moneda original (carril rojo)

- Hoy el sueldo se guarda en dólares. Columnas nuevas para el monto mínimo, el máximo y la moneda tal como los publica el aviso, más la periodicidad. Migración.
- **La pantalla muestra el original:** «$ 1.200.000 a $ 1.500.000 por mes (ARS)». Si además hay una equivalencia, va aparte y dice que es aproximada.
- Los lectores y adaptadores que ya extraen sueldo guardan también el original. Tests con pesos, dólares, euros y reales.
- Lo que ya está guardado queda como está: no se inventa una moneda para lo viejo.

### R32-09 · Email de novedades

- Un email, como mucho semanal, con las ofertas nuevas de la carrera de la persona. Revisá `packages/pipeline/src/digest/`.
- Detrás de una variable apagada. Se prueba con el adaptador simulado.
- Baja en un clic, sin iniciar sesión, y una preferencia en la configuración.
- Si no hay ofertas nuevas, no se manda nada.
- Sellos y textos, los de la R30.

### R32-10 · Calidad (lead)

- **e2e:** alta con carrera obligatoria; carrera no abierta que deriva a la lista de espera; pocas ofertas con la guía; panel de cobertura con una carrera en verde y otra en rojo; baja del email.
- 390 y 360 px, teclado y axe.
- `verificacion-informe-ani.md` al día.

## Cierre

El de `docs/beta/cadena-r30-r34.md` §3. En los pasos manuales: las migraciones; el registro de las claves de Jooble y de ReliefWeb; las pruebas con `--dry-run`; la lista de alertas de Computrabajo que tiene que crear Ani, carrera por carrera; qué mirar en el panel para decidir la primera carrera. Después, **seguí con la R33.**
