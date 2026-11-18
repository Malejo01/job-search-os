# Fuente: Workable (widget público de cada cuenta) · integrada, apagada

Adapter: `packages/adapters/src/sources/workable.ts` (+ `ats-common.ts`). Estado: **integrada, apagada** (R16-2). No está en `POOL_RECOMMENDED_SOURCES`: se prende con `POOL_SOURCES`, después del `--dry-run`, de revisar los términos y de cargar boards con `enabled = false`. Necesita una migración (check `ats_boards_provider_check` y valor `workable` del enum `source_kind`) que aplica el dueño del proyecto. No es asesoramiento legal.

## Qué ofrece
Workable es un ATS con muchas empresas medianas que contratan remoto, algunas en LatAm y España. Como Teamtailor y los ATS de ADR-018, se usa con una **lista curada de empresas**: la cuenta es el token del board en `ats_boards`. La API v3 de Workable necesita un token del cliente (la empresa) y **no sirve** para esto.

## Cómo se lee
- `GET https://apply.workable.com/api/v1/widget/accounts/<cuenta>?details=true`, sin clave. La URL pública `https://www.workable.com/api/accounts/<cuenta>?details=true` redirige a esta: se usa **directo la final** y las redirecciones están desactivadas (`redirect: "error"`), así que una respuesta nunca manda a otro host.
- La cuenta se valida como etiqueta DNS estricta (`[a-z0-9-]`, sin guion en los bordes, máx. 63), antes de armar la URL. No lleva región.
- Una request por board, en serie, 8 s, un reintento ante 429 o 5xx y tope de 15 MB (como los demás ATS).
- **Formato a verificar:** no hay una respuesta real grabada (la nube no tiene salida a esos hosts). Lo que se asume está en el comentario de `workable.ts`; las fixtures de los tests son inventadas. Se confirma con `pnpm pool:fetch workable <cuenta> --dry-run`, que compara los campos que lee el mapper con los que trae la respuesta, sin imprimir valores.

## Qué se guarda
| Workable | RawJob | Nota |
|---|---|---|
| `shortcode` (o `id`) | `source.externalId = workable:{cuenta}:{id}` | sin id, título o link el aviso se saltea |
| `url`, si no `shortlink`, si no `application_url` | `source.url` | tiene que ser http(s) y de `workable.com` o un subdominio; si no, se saltea |
| `title` | `title` | |
| `locations[]` (ciudad, región, país; sin las `hidden`) o `city`/`state`/`country` | `locationRaw` | lo que no dice queda `null` |
| `telecommuting` | `modality` y filtro de remotos | ver abajo |
| `employment_type`, `department` | `contractType`, `categories` | |
| `description` (HTML) | `jdText` | por `atsHtmlToText` |
| `published_on` (si no `created_at`) | `postedAt` | |
| (no trae) | `countriesAllowed = null`, sin salario | el prefiltro marca el riesgo de ubicación |

**Remoto: solo lo que la API declara.** El filtro común de los ATS (`isPoolRemoteCandidate`) deja pasar un aviso sin ubicación. Para Workable no: solo `telecommuting === true` entra como remoto. Con `false`, sin el dato o con un valor que no es booleano el aviso se descarta, y el texto de la ubicación («Remote», un país de LATAM) no lo cambia: el mapper no se lo pasa al filtro.

## Términos de uso: A VERIFICAR antes de prender un board
Los términos de Workable no tienen, según la lectura de la ronda 103, una cláusula específica sobre scraping, pero prohíben usar IA que compita con Workable. **No se pudieron leer ni confirmar las condiciones de uso del endpoint sin clave** (`apply.workable.com/api/v1/widget/...`). Condiciones antes de prender cualquier board:
1. Leer los términos completos y confirmar que listar y mostrar avisos públicos, con atribución («Sitio de empleos» y link al aviso original), no entra en esa prohibición.
2. Confirmar que ese endpoint está pensado para consumo público sin clave y qué límites de uso tiene.
3. Revisar el `robots.txt` del host (`apply.workable.com`) y el de cada empresa si tiene dominio propio.
4. Lista curada de empresas, de a un board por vez y con `enabled = false` hasta correr el `--dry-run`.

## Cómo se prende (todo a mano, nada se prende solo)
1. Migración aplicada (ver el PR).
2. `pnpm pool:fetch workable empresa-ficticia --company "Empresa Ficticia 1" --dry-run`
3. Cargar el board apagado:
   ```sql
   INSERT INTO ats_boards (provider, token, company_name, enabled)
   VALUES ('workable', 'empresa-ficticia', 'Empresa Ficticia 1', false);
   ```
4. Cuando los términos estén confirmados: `enabled = true` y agregar `workable` a `POOL_SOURCES`.
