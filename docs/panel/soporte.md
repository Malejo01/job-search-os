# Panel · `soporte`: soporte IT con 3 años (Windows, redes, mesa de ayuda)

Persona sintética (ficha en `fichas.md`). Recorrido en la app local con datos ficticios y el LLM en modo demo. Lente: perfil que no es de desarrollo. Las capturas no se versionan; los números entre paréntesis las nombran.

## Resumen
- Hizo todo solo en unos 6 minutos y cargó 4 JDs.
- Las skills nuevas de soporte (ronda 31) aparecen, se guardan y se pueden cambiar.
- Después de eso, la app lo trata como desarrollador en todo: ofertas de la fuente, mercado, plan, el ejemplo del perfil y los bloqueadores.
- Mientras no cuenten sus ofertas, mercado y plan lo mandan a estudiar SQL, Python y NestJS. Para un técnico de soporte, es un dato equivocado.
- **Ya reportados, vistos de nuevo:**
  - disciplina de fábrica (`administracion_plataformas` / `otra`, de 9 a 4);
  - prefiltro con la presencial de su ciudad, con "solo remoto" desmarcado;
  - "años en otro dominio (soporte IT)";
  - "Marcar aplicada" como botón principal;
  - jerga, menú cortado, mercado sin foco y que no incluye sus ofertas hasta guardar;
  - sin "Perfil" en Ajustes, el rol no se recuerda, el buscador por subcadena.

## Skills de soporte (lo que se pidió mirar)
- **Al elegir "Soporte IT" aparecen:** Help desk, Redes, Windows Server, Administración Linux, Active Directory, ITIL, Client-facing, Ciberseguridad, IAM, Azure e Inglés intermedio. Buena lista.
- **En `/market`**, después de guardar (unos 16 s): Help desk y Redes como diferenciales, Azure como gap. Funciona y se entiende.
- **Active Directory** (nivel 2, 1 mención) aparece solo en la tabla completa: "En crecimiento" dice "nada en esta categoría". Probable umbral de demanda que no se explica.

## Hallazgos nuevos

### 1. Bloqueante · Los gaps de un perfil de soporte son SQL, ETL, Snowflake y Python
- **Pantalla:** `/market` (`13`, `17`).
- **Qué pasó:** con 0 ofertas propias contadas, el primer gap es "SQL / PostgreSQL, requisito 5 de 5 avisos". "Lo que más piden las ofertas que te interesan" sale de las 7 ofertas de la fuente, todas de desarrollo y datos.
- **Arreglo:** ponderar o filtrar por el rol, "Basado en N ofertas de Soporte IT", y con menos de 5, "Todavía no hay suficientes ofertas de tu rol".

### 2. Bloqueante · El plan tiene 27 skills y unas 507 h, ninguna de soporte
- **Pantalla:** `/plan` (`14`).
- **Qué pasó:**
  - incluye SQL, Python, ETL, Snowflake, TypeScript, NestJS, RAG, Vue, Go, Java y .NET;
  - casi todas dicen "sin recurso aprobado" y "~0 h para cerrar", que se lee como "tarea gratis";
  - 27 filas con "Empezar" y "Cerrar" abruman.
- **Arreglo:**
  - las 5 principales con "Ver el resto";
  - "tiempo sin estimar";
  - recursos de soporte en el catálogo (certificaciones de gestión de servicios y de nube introductoria, redes).

### 3. Importante · El ejemplo del onboarding es solo de desarrollo
- **Pantalla:** `/onboarding` (`02`).
- **Qué pasó:** el ejemplo es de una backend con Python y PostgreSQL. No sabe qué escribir en "dominás con proyectos en producción" siendo de mesa de ayuda. El rol recién se elige en el paso siguiente.
- **Arreglo:** ejemplos por perfil (por ejemplo: "Técnico de soporte con 3 años, tickets en Windows y redes de oficina; intermedio en Azure; sin experiencia en Linux de servidor. Inglés B1."). El rol, en el mismo paso.

### 4. Importante · El buscador dice "No hay skills con ese nombre" cuando la skill ya está en la lista
- **Pantalla:** `/onboarding/skills?rol=soporte_it` y `/settings/skills` (`06`).
- **Qué pasó:** "mesa de ayuda", "windows" y "linux" dan el mensaje, y las tres están arriba. El buscador oculta lo que ya se muestra; una persona nueva piensa que la app no conoce la skill.
- **Probable causa:** lo mismo explica que "soporte técnico" no encuentre nada, aunque es alias de Help desk.
- **Arreglo:** mostrar las ya listadas con "ya está arriba" o cambiar el texto vacío.

### 5. Importante · Faltan skills y sinónimos de soporte
- **Qué pasó:**
  - "office", "Office 365", "Microsoft 365" y "ticket" no encuentran nada, y sus JDs los piden;
  - de una JD que pide Windows 10/11, Office 365, DHCP, DNS y sistema de tickets, el mercado extrajo solo Redes y Help desk;
  - no hay macOS, MDM, PowerShell ni certificaciones.
- **Arreglo:** aliases ("tickets", "mesa de servicio") y skills nuevas: Microsoft 365, Windows de escritorio, macOS y MDM, PowerShell, virtualización. Va con JS-133 / taxonomía.

### 6. Importante · En Ofertas, 7 ofertas de desarrollo y ninguna de soporte
- **Pantalla:** `/jobs` (`08`, `16`).
- **Qué pasó:** siguen en "Evaluando…" varios minutos después y se ordenan arriba de las suyas.
- **Arreglo:** filtrar por rol o marcar "no coincide con tu rol". En el asistente, decir que otros portales también se pueden reenviar (cuidando no prometer un parser que no existe).

### 7. Importante · "Años de experiencia" no dice qué cuenta
- **Qué pasó:** ¿en el rol o en total? El dato alimenta el bloqueador "años en otro dominio".
- **Arreglo:** "Años en el rol que buscás", o dos campos.

### 8. Importante · El mismo hecho aparece como riesgo y como bloqueador
- **Pantalla:** detalle de "IT Support Specialist" (Remote, US only).
- **Qué pasó:** el bloqueador "Autorización laboral exigida" convive con el riesgo "país no listado (US only)". "Inglés requerido nativo, tenés B1" figura como riesgo cuando la JD lo pide como requisito.
- **Arreglo:** no repetir; inglés nativo obligatorio como bloqueador.

### 9. Importante · Gaps "(must)" que ya declaró tener
- **Qué pasó:**
  - "Active Directory y directivas de grupo (must)" figura como gap con AD en nivel 2;
  - "IAM y MFA (must)" figura como gap con IAM en nivel 1.
  Puede ser del LLM en modo demo.
- **Arreglo:** mostrar el nivel declarado junto al gap.

### 10. Pulido · `/jobs/new` pide salario solo en USD
- **Arreglo:** "(opcional, en USD)" o moneda local con conversión.

### 11. Pulido · Los filtros ocupan media pantalla en el celular (`16`)
- **Arreglo:** `<details>` "Filtrar" cerrado, con solo "Score mín." visible.

### 12. Pulido · Formulario de postulación en ofertas descartadas

### 13. Pulido · Ruido en "Candidatos a skill nueva" (PTO, hrs)

## Lo que funcionó bien
1. Registro: link de invitación, términos plegados y aviso de cuenta creada, claros.
2. El error de resumen corto se entiende y conserva lo cargado.
3. La lista de skills de Soporte IT está bien elegida, con niveles que no intimidan y "Saltear por ahora" visible.
4. El mercado reflejó sus skills en unos 16 s; en el celular las tarjetas son legibles.
5. El veredicto habla en segunda persona y se entiende.
