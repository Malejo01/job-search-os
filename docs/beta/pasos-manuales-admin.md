# Pasos manuales · Panel /admin (ADM-1 y ADM-2)

## 1. Migración (antes o junto con el merge)
Trae la migración Drizzle 0078 (`user_roles`, `admin_events` y `users.blocked_at`) y la RLS 0064 (funciones del panel; login y sesión sin las cuentas bloqueadas). Las dos son aditivas: no tocan datos.

```powershell
cd "C:\Programacion\Job Search 2026\job-search-os-v1\job-search-os"
git fetch origin; git switch --detach origin/ronda/admin-panel
$env:CONFIRM_PRODUCTION="si"; pnpm db:migrate
```
O pedile a Claude que la aplique en Neon.

## 2. Probar
1. https://afiniajobs.com.ar/admin: la portada con los pendientes.
2. **Personas:** buscá una cuenta, abrí la ficha, hacela tester y después sacale el rol. Las dos cosas quedan en el historial.
3. **Bloqueo:** con una cuenta de prueba, bloqueá → esa sesión se cierra y no puede entrar → desbloqueá.
4. **Links viejos:** /settings/planes tiene que llevar a /admin/planes.

## 3. Lo que no cambia
- **Admins:** siguen en `ADMIN_EMAILS` (Vercel) y `app_admins`.
- **`ASSISTANT_TESTER_EMAILS`** sigue valiendo. Los testers del panel se suman a esa lista.
