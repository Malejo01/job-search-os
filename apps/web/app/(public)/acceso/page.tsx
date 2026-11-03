import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BETA_OPENING_LABEL, BRAND, waitlistRoleGroups } from "@job-search-os/pipeline";
import { Illustration } from "@/components/brand/illustration";
import { Icon } from "@/components/ui";
import { accesoFunnelEnabled } from "@/lib/acceso-funnel";
import { contactLink } from "@/lib/contact";
import { ROLE_SKILLS } from "@/lib/skill-levels";
import { WaitlistForm, WaitlistFormFields } from "./waitlist-form";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Pedir acceso",
  description:
    "La beta es por invitación. Dejá tu nombre, email y carrera y te avisamos cuando haya lugar.",
  alternates: { canonical: "/acceso" },
};

/**
 * Las seis carreras de la beta, en el orden del anuncio (`BETA_LAUNCH_ROLE_KEYS`). Escritas como se
 * dicen: los nombres de los selectores son más largos y en el celular no entran en una línea.
 */
const BETA_CAREERS_TEXT =
  "Para 6 carreras: abogacía, contaduría, administración, comunicación, marketing y RR.PP., y relaciones internacionales.";

export default function AccesoPage() {
  // La lista de espera ofrece las carreras de la beta aunque sigan ocultas en los selectores (ADR-027):
  // quien se anota el 11/11 tiene que poder elegir la suya. Las 6 van primero, en «Carreras de la beta».
  const groups = waitlistRoleGroups().map((group) => ({
    label: group.label,
    roles: group.roles.map((key) => ({ key, label: ROLE_SKILLS[key].label })),
  }));
  const formProps = {
    groups,
    contact: contactLink("Borrar mis datos de la lista de espera"),
    // Embudo (C8-2): apagado salvo `ACCESO_FUNNEL_ENABLED=1` (con la migración 0057 aplicada)
    funnel: accesoFunnelEnabled(),
    brandName: BRAND.name,
  };
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 sm:max-w-lg">
      {/* Cabecera índigo curva (C9-16, decisión 6): lo primero que ve quien llega por el QR desde el
          celular. En el celular se pega a la barra de arriba; la ilustración «acceso» va adentro */}
      <section
        aria-labelledby="acceso-marca"
        className="-mx-4 -mt-6 flex flex-col gap-3 rounded-b-[2.5rem] bg-ink px-5 pt-5 pb-8 text-on-ink sm:mx-0 sm:mt-0 sm:rounded-container sm:p-7"
      >
        <div className="flex items-end justify-between gap-4">
          <p id="acceso-marca" className="font-display text-[28px] leading-tight font-extrabold">
            {BRAND.tagline}
          </p>
          <Illustration escena="acceso" priority className="w-28 sm:w-40" />
        </div>
        <p className="text-sm text-on-ink-muted">
          Leemos cada oferta contra tu perfil y te decimos por qué sí y por qué no. Vos decidís.
        </p>
        <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm text-on-ink-muted">
          <li className="flex gap-2">
            <Icon name="check" size={18} className="shrink-0 text-on-ink" />
            <span>
              Beta cerrada: abre el <strong className="text-on-ink">{BETA_OPENING_LABEL}</strong>.
            </span>
          </li>
          <li className="flex gap-2">
            <Icon name="check" size={18} className="shrink-0 text-on-ink" />
            <span>{BETA_CAREERS_TEXT}</span>
          </li>
          <li className="flex gap-2">
            <Icon name="check" size={18} className="shrink-0 text-on-ink" />
            <span>El cupo es limitado.</span>
          </li>
        </ul>
      </section>
      <h1 className="text-title font-bold">Pedir acceso</h1>
      {/* La frase introductoria vive en el formulario: desaparece cuando el pedido se envió */}
      {/* Fallback = el mismo formulario sin el origen: sin salto de layout al leer la URL (C7-15) */}
      <Suspense fallback={<WaitlistFormFields {...formProps} initialHeardFrom="" />}>
        <WaitlistForm {...formProps} />
      </Suspense>
      <p className="text-sm">
        <Link
          href="/login"
          className="inline-flex min-h-11 items-center font-semibold text-link underline underline-offset-2 hover:text-link-hover"
        >
          Ya tengo cuenta
        </Link>
      </p>
    </div>
  );
}
