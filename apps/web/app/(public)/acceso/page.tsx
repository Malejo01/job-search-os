import type { Metadata } from "next";
import { Suspense } from "react";
import {
  BETA_LAUNCH_ROLE_KEYS,
  BRAND,
  ILLUSTRATIONS,
  waitlistRoleGroups,
} from "@job-search-os/pipeline";
import { Illustration } from "@/components/brand/illustration";
import { cardClasses } from "@/components/ui";
import { accesoFunnelEnabled } from "@/lib/acceso-funnel";
import { contactLink } from "@/lib/contact";
import { ROLE_SKILLS } from "@/lib/skill-levels";
import { WaitlistForm, WaitlistFormFields, WaitlistPrivacy } from "./waitlist-form";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Pedir acceso",
  description:
    "La beta es por invitación. Dejá tu nombre, email y carrera y te avisamos cuando haya lugar.",
  alternates: { canonical: "/acceso" },
};

/**
 * Las seis carreras de la beta como chips (C10-5, acceso-pc.png), en el orden del anuncio
 * (`BETA_LAUNCH_ROLE_KEYS`) y con el nombre corto con que se dicen.
 */
const BETA_CAREER_NAMES: Record<string, string> = {
  abogacia: "Abogacía",
  finanzas_contabilidad: "Contaduría",
  administracion_empresas: "Administración",
  comunicacion: "Comunicación",
  marketing_digital: "Marketing y RR.PP.",
  relaciones_internacionales: "Relaciones internacionales",
};

/**
 * /acceso (C10-5): copia de las pantallas aprobadas el 4/11 (`referencias/acceso-pc.png` y
 * `acceso-cel.png`, medidas de `S1-publicas.html`). Cabecera índigo curva pegada a la barra, con
 * el titular, la bajada y el lugar de la ilustración «acceso» (va el marcador hasta que exista);
 * la tarjeta del formulario se monta sobre la cabecera. La lógica es la de C8: embudo, topes del
 * evento y confirmación. `data-ancho` y `data-pagina` le dicen al layout público que vaya a lo
 * ancho y que la barra lleve solo el logo y «Entrar».
 */
export default function AccesoPage() {
  // La lista de espera ofrece las carreras de la beta aunque sigan ocultas en los selectores (ADR-027):
  // las 6 van como chips; las demás, en «Otra carrera» (el grupo «Carreras de la beta» sigue primero)
  const groups = waitlistRoleGroups().map((group) => ({
    label: group.label,
    roles: group.roles.map((key) => ({ key, label: ROLE_SKILLS[key].label })),
  }));
  const formProps = {
    groups,
    betaCareers: BETA_LAUNCH_ROLE_KEYS.map((key) => ({
      key,
      label: BETA_CAREER_NAMES[key] ?? ROLE_SKILLS[key].label,
    })),
    contact: contactLink("Borrar mis datos de la lista de espera"),
    // Embudo (C8-2): apagado salvo `ACCESO_FUNNEL_ENABLED=1` (con la migración 0057 aplicada)
    funnel: accesoFunnelEnabled(),
    brandName: BRAND.name,
  };
  return (
    <div data-ancho="completo" data-pagina="acceso" className="flex w-full flex-col pb-12">
      <section
        aria-labelledby="acceso-titulo"
        className="rounded-b-[40px] bg-ink px-5 pt-1 pb-[78px] text-on-ink sm:rounded-b-[56px] sm:pt-[18px] sm:pb-[120px]"
      >
        <div className="mx-auto flex max-w-[1280px] flex-col gap-[18px] sm:flex-row-reverse sm:items-center sm:gap-10 sm:px-[72px]">
          {/* Sin archivo no se muestra el marcador punteado; vuelve solo cuando el arte exista */}
          {ILLUSTRATIONS.acceso.available ? (
            <Illustration
              escena="acceso"
              priority
              className="h-[170px] w-full sm:h-[270px] sm:w-[360px]"
            />
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col gap-2.5 sm:gap-4">
            <h1
              id="acceso-titulo"
              className="text-[31px] leading-[1.06] font-extrabold tracking-[-1px] text-on-ink sm:text-[54px] sm:leading-[1.04] sm:tracking-[-1.6px]"
            >
              Anotate para la beta<span className="hidden sm:inline"> de {BRAND.name}</span>
            </h1>
            <p className="max-w-[540px] text-[15px] leading-[1.5] font-medium text-on-ink-muted sm:text-lg">
              <span className="sm:hidden">
                Abrimos el 26 de noviembre para 6 carreras. El cupo es limitado.
              </span>
              <span className="hidden sm:inline">
                Para estudiantes y recién recibidos de 6 carreras. Abrimos el 26 de noviembre. El
                cupo es limitado.
              </span>
            </p>
          </div>
        </div>
      </section>
      <div
        className={cardClasses({
          level: "featured",
          padding: "none",
          className:
            "relative mx-[14px] -mt-14 p-[18px] sm:mx-auto sm:-mt-[92px] sm:w-[828px] sm:max-w-[calc(100%-2rem)] sm:px-8 sm:py-7",
        })}
      >
        {/* Fallback = el mismo formulario sin el origen: sin salto de layout al leer la URL (C7-15) */}
        <Suspense fallback={<WaitlistFormFields {...formProps} initialHeardFrom="" />}>
          <WaitlistForm {...formProps} />
        </Suspense>
      </div>
      <div className="mx-auto mt-5 w-full max-w-[828px] px-5 sm:px-8">
        <WaitlistPrivacy contact={formProps.contact} />
      </div>
    </div>
  );
}
