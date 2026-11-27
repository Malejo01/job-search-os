import { calibrationCsv, jobCardMode } from "@job-search-os/pipeline";
import { adminRouteDenied } from "@/lib/admin-guard";
import { loadAdminCalibrationMarks } from "@/lib/calibration";
import { requireUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * CSV de lo que marcaron testers y admins sobre la evaluación nueva (R31-10). Solo admins (`ADMIN_EMAILS` y
 * `app_admins` en la base, rls/0073): el resto recibe el 404 de siempre. Sin email, nombre ni datos del perfil;
 * celdas sin fórmulas de planilla. La función de la base ya filtra; acá se vuelve a filtrar por versión.
 */
export async function GET(): Promise<Response> {
  const userId = await requireUserId();
  const denied = await adminRouteDenied(userId);
  if (denied) return denied;
  // Con JOB_CARD apagada el kit no existe, tampoco la exportación (la app queda como al cerrar la R30)
  if (jobCardMode(process.env) === "off") {
    return new Response("No encontrado", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  let rows;
  try {
    rows = await loadAdminCalibrationMarks(userId);
  } catch {
    // La función de la base le exige ser admin otra vez: si falla, no hay nada que mostrar
    return new Response("No encontrado", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return new Response(calibrationCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="calibracion-evaluacion-nueva.csv"',
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
