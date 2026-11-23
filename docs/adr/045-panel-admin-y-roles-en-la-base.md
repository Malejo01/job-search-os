# ADR-045 · Panel /admin y roles en la base

- **Estado:** aceptada (23/11/2026)
- **Contexto:** dar acceso a la beta, hacer tester a alguien o cortar una cuenta exigía tocar Vercel (`ASSISTANT_TESTER_EMAILS`) o la base. Las pantallas de administración estaban sueltas dentro de /settings.

## Decisión
1. **Un panel /admin** con barra lateral, como el de MaestrIA. Las pantallas de administración de /settings se mudan ahí y los links viejos redirigen (307). El layout corta con 404 a quien no es admin y cada página y acción lo vuelve a comprobar (`lib/admin-guard`).
2. **Roles en la base (`user_roles`)**, con un solo rol por ahora: `tester`. Se suma al env de esa persona (`withDbTesters`) solo para su propia decisión, así las etapas «testers» siguen saliendo de las mismas funciones puras. Nunca toca `ADMIN_EMAILS`.
3. **Ser admin no se da desde el panel.** Sigue siendo `ADMIN_EMAILS` + `app_admins`: un clic equivocado no le da acceso total a nadie.
4. **Bloqueo con `users.blocked_at`.** `auth_user_by_email` no devuelve la cuenta y `user_session_version` da null, así que no entra y sus sesiones abiertas se cierran. Al bloquear sube `session_version`. No se puede bloquear a un admin ni a la propia cuenta. No se borra nada.
5. **Historial (`admin_events`)** de cada acción del panel. Los cambios de plan siguen en `plan_events`. La ficha muestra los dos.

## Consecuencias
- Todo pasa por funciones `SECURITY DEFINER` con la barrera `app_admins` (rls/0064). La app no lee ni escribe las tablas nuevas.
- Si la migración todavía no está aplicada, `my_roles()` falla y la persona queda como antes: falla cerrado hacia «sin roles».
