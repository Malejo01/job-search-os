import { createLogger } from "@job-search-os/adapters";
import {
  fewOffersNotice,
  joinLabels,
  type CareerVolume,
  type FewOffersNotice as Notice,
} from "@job-search-os/pipeline";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import Link from "next/link";
import { catalogLabel } from "@/lib/career-names";
import { getCareerMarket } from "@/lib/career-market";
import { getProfileForEdit, getTargetRoles } from "@/lib/onboarding";
import { requireActiveUserId } from "@/lib/session";
import { ALTA_TEXTOS, llenarTexto } from "@/lib/textos-rediseno";
import { Alert, buttonClasses, textLinkClasses } from "@/components/ui";

const T = ALTA_TEXTOS.pocasOfertas;

/** Cookie de «Ahora no»: solo UX (httpOnly, 3 días), con el id de la persona para que un navegador compartido no mezcle cuentas. */
export const FEW_OFFERS_COOKIE = "jso_pocas_ofertas";
const FEW_OFFERS_MAX_AGE = 60 * 60 * 24 * 3;

/** «Ahora no»: guarda la cookie y el aviso vuelve a los tres días si sigue habiendo pocas ofertas. No toca la base. */
async function dismissFewOffersAction(): Promise<void> {
  "use server";
  const userId = await requireActiveUserId();
  const jar = await cookies();
  jar.set(FEW_OFFERS_COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: FEW_OFFERS_MAX_AGE,
  });
  revalidatePath("/jobs");
}

/** Lo que dice el aviso, con los números del pipeline. Los nombres de carrera salen del catálogo, nunca de un pedido. */
function copyOf(notice: Notice) {
  return {
    title: llenarTexto(T.titulo, {
      carreras: joinLabels(notice.careers.map((c) => c.label)),
      idioma: notice.noun,
    }),
    rows: notice.careers.map((c) => llenarTexto(T.fila, { carrera: c.label, n: c.count })),
    text: llenarTexto(T.texto, { umbral: notice.threshold }),
  };
}

/**
 * Estado vacío por carrera (R32-04): si alguna de las carreras de la persona tiene pocas ofertas en su idioma esta
 * semana, la pantalla lo dice sin vueltas y ofrece el paso siguiente (la guía de alertas o cargar una oferta). El
 * volumen sale del mercado por carrera, que se cachea 30 minutos y no lleva datos de nadie: la única lectura
 * por persona son sus carreras y su idioma. Si algo falla, no se muestra (el aviso nunca rompe la lista).
 */
export async function FewOffersNotice({ userId }: { userId: string }) {
  const jar = await cookies();
  if (jar.get(FEW_OFFERS_COOKIE)?.value === userId) return null;
  let notice: Notice | null;
  try {
    const [roles, profile] = await Promise.all([getTargetRoles(userId), getProfileForEdit(userId)]);
    if (roles.length === 0) return null;
    const volumes: (CareerVolume & { label: string })[] = await Promise.all(
      roles.map(async (role) => {
        const { total, writtenInSpanish } = (await getCareerMarket(role)).volume.last7d;
        return { role, total, writtenInSpanish, label: catalogLabel(role) };
      }),
    );
    notice = fewOffersNotice(volumes, profile?.jobLanguage ?? "both");
  } catch (err) {
    createLogger({ user_id: userId, task: "pocas_ofertas" }).warn(
      { errName: err instanceof Error ? err.name : "desconocido" },
      "no se pudo leer el volumen de ofertas",
    );
    return null;
  }
  if (!notice) return null;
  const copy = copyOf(notice);
  return (
    <Alert tone="info" role="note" data-testid="pocas-ofertas">
      <div className="flex flex-col gap-2">
        <p className="font-bold">{copy.title}</p>
        <ul className="m-0 list-disc pl-5" data-testid="pocas-ofertas-filas">
          {copy.rows.map((row) => (
            <li key={row}>{row}</li>
          ))}
        </ul>
        <p>{copy.text}</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link
            href="/settings/asistente"
            data-testid="pocas-ofertas-guia"
            className={buttonClasses({ size: "sm", variant: "secondary" })}
          >
            {T.guia}
          </Link>
          <Link
            href="/jobs/new"
            data-testid="pocas-ofertas-cargar"
            className={textLinkClasses({ block: true })}
          >
            {T.cargar}
          </Link>
          <form action={dismissFewOffersAction}>
            <button
              type="submit"
              className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
            >
              {T.cerrar}
            </button>
          </form>
        </div>
      </div>
    </Alert>
  );
}
