# Boards candidatos para el pool (R28-07)

Propuesta, **sin cargar nada**: ninguna fila se insertó en `ats_boards`. El SQL del final está todo comentado
y apagado (`enabled = false`). Lo revisa y lo corre el dueño del proyecto.

- **Fecha de la verificación:** 25/11/2026. Una sola vez, con `pnpm pool:fetch <proveedor> <token> --dry-run`
  (solo lectura, sin base de datos, sin imprimir títulos ni empresas). 22 pedidos en total.
- **Qué mide el `--dry-run`:** avisos vistos, cuántos pasan el filtro de **remotos** (el pool solo guarda
  remotos declarados) y a qué carreras caen según las reglas de `role_hints` vigentes (incluye las de R28-06).
- **Regla de la lista:** entra solo un board que respondió y tiene al menos un aviso remoto. Los demás van al
  apéndice de descartados.
- Las empresas son públicas; no hay nada del perfil ni de la búsqueda de nadie.

## Resultado honesto

De 22 tokens probados (todos suposiciones mías de cómo se llama cada empresa en su ATS), **3 sirven**. El
resto no existe con ese nombre, está vacío o no tiene avisos remotos. Nadie debería cargar boards de acá sin
volver a correr el `--dry-run`: los avisos cambian a diario. La lista no llega a 30 porque no hay forma de
adivinar tokens: la fuente real de candidatos es la gente que vea un aviso de empresas con sitio propio
(ver «Cómo seguir»).

## Candidatos verificados (3)

| # | Empresa | ATS | Token | Vistos | Remotos | Carreras en las que caen (reglas R28-06) | Idioma |
|---|---|---|---|---|---|---|---|
| 1 | Despegar | Lever | `despegar` | 102 | **3** | ventas B2B 1, relaciones internacionales y comercio exterior 1, relaciones públicas 1 | es 2, pt 1 |
| 2 | QuintoAndar | Greenhouse | `quintoandar` | 91 | **9** | marketing 1; el resto es desarrollo (frontend, backend, fullstack) y 6 sin carrera | es 7, en 2 |
| 3 | EBANX | Greenhouse | `ebanx` | 38 | **4** | producto 1, ventas B2B 2, contaduría y finanzas 1 | en 4 |

Lectura:
- **Despegar** es la más cercana al objetivo (empresa argentina; 3 remotos de 102, en español, ninguno de
  tecnología). Valor bajo en volumen, alto en relevancia.
- **QuintoAndar** aporta casi todo desarrollo; sirve poco a las carreras no técnicas (1 aviso de marketing).
  Es de Brasil: los avisos pueden ser para residentes de allá (el prefiltro lo marca como riesgo de ubicación).
- **EBANX** aporta unos pocos avisos en inglés de ventas y finanzas; también es de Brasil.
- Ninguno de los 3 declara países permitidos (`countriesAllowed` queda `null`): el prefiltro marca el riesgo.

## Para verificar (sin verificar, el guard del equipo no deja tocar esas APIs)

Teamtailor, Workable, Recruitee y SmartRecruiters quedan **sin verificar**: el equipo solo puede correr
`pool:fetch` con Greenhouse, Lever y Ashby. No propongo tokens de esos cuatro proveedores porque no tengo
forma de saber cuáles existen; para probar uno que alguien vea en un aviso real, el dueño del proyecto corre
(desde su máquina, una vez por board, reemplazando `<User-Agent del proyecto>` por `NombreDelProducto/1.0 (+https://<dominio>)`):

```
# Recruitee (R28-05): hoy responde sin token; desde el 10/02/2027 exige el de la empresa
curl -s -A "<User-Agent del proyecto>" "https://<empresa>.recruitee.com/api/offers/"

# SmartRecruiters (R28-05): el id es el de la empresa en jobs.smartrecruiters.com/<id>
curl -s -A "<User-Agent del proyecto>" "https://api.smartrecruiters.com/v1/companies/<id>/postings?limit=5"

# Workable
curl -s -A "<User-Agent del proyecto>" "https://apply.workable.com/api/v1/widget/accounts/<slug>?details=true"

# Teamtailor (RSS)
curl -s -A "<User-Agent del proyecto>" "https://<slug>.teamtailor.com/jobs.rss"
```

Cuenta como board válido si responde 200 con al menos un aviso que declare trabajo remoto. Para ver las
carreras en las que cae, cuando la fuente esté prendida: `pnpm pool:fetch <proveedor> <token> --dry-run`
(Recruitee y SmartRecruiters ya están en el comando desde R28-05).

## Cómo seguir
- Para cada empresa que publique en su propio sitio de empleos (Despegar-style): mirar el link del botón
  «Postular». Si empieza con `jobs.lever.co/<token>`, `boards.greenhouse.io/<token>`,
  `jobs.ashbyhq.com/<token>`, `<token>.recruitee.com`, `jobs.smartrecruiters.com/<id>`,
  `apply.workable.com/<token>` o `<token>.teamtailor.com`, ese es el token. Así se evita adivinar.
- Cargarlos de a poco y con `enabled = false` hasta correr el `--dry-run`.

## Apéndice · descartados (19)

| Proveedor | Token | Motivo |
|---|---|---|
| greenhouse | `dlocal` | 404: no existe con ese nombre |
| ashby | `deel` | responde, 0 avisos (el slug real puede ser otro) |
| greenhouse | `remotecom` | responde, 0 avisos |
| greenhouse | `gitlab` | **responde y tiene remotos** (250 vistos, 200 remotos tras el tope), pero es una empresa global sin foco en LatAm y llenaría el pool de avisos técnicos y de ventas de otros países; no encaja en el objetivo |
| greenhouse | `bitso` | 404 |
| greenhouse | `kavak` | 404 |
| lever | `belvo` | 404 |
| greenhouse | `nubank` | responde, 0 avisos |
| lever | `pomelo` | 404 |
| lever | `wizeline` | 404 |
| lever | `bairesdev` | 404 |
| greenhouse | `papayaglobal` | 404 |
| ashby | `remote` | 404 |
| lever | `kushki` | 404 |
| greenhouse | `vtex` | responde, 30 avisos, **0 remotos** (todo presencial o híbrido): no aporta |
| greenhouse | `clip` | 404 |
| lever | `creditas` | 404 |
| lever | `uala` | 404 |
| greenhouse | `tiendanube` | 404 |

## SQL candidato (todo comentado, apagado)

No se aplica nada. Revisar, probar con `--dry-run` y recién ahí descomentar de a una fila. La tabla es global
(sin datos de personas); `enabled = false` hace que el cron no la lea hasta que se prenda a mano.

```sql
-- Verificados el 25/11/2026 (ver tabla de arriba). Descomentar de a una fila, con el SQL revisado.
-- insert into ats_boards (provider, token, region, company_name, enabled, notes) values
--   ('lever',      'despegar',    null, 'Despegar',    false, 'R28-07 · 3 remotos de 102 el 25/11/2026 · ventas, relaciones internacionales, RR.PP.'),
--   ('greenhouse', 'quintoandar', null, 'QuintoAndar', false, 'R28-07 · 9 remotos de 91 el 25/11/2026 · casi todo desarrollo; 1 marketing'),
--   ('greenhouse', 'ebanx',       null, 'EBANX',       false, 'R28-07 · 4 remotos de 38 el 25/11/2026 · ventas B2B, finanzas, producto')
-- on conflict (provider, token) do nothing;

-- Para prender uno, después de mirar su --dry-run:
-- update ats_boards set enabled = true where provider = 'lever' and token = 'despegar';
```
