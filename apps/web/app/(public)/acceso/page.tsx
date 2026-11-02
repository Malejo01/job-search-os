import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BETA_OPENING_LABEL, BRAND, waitlistRoleGroups } from "@job-search-os/pipeline";
import { Logo } from "@/components/brand/logo";
import { contactLink } from "@/lib/contact";
import { ROLE_SKILLS } from "@/lib/skill-levels";
import { WaitlistForm } from "./waitlist-form";

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
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 py-4 sm:py-8">
      {/* Bloque de marca (C7-10): lo primero que ve quien llega por el QR desde el celular */}
      <section
        aria-labelledby="acceso-marca"
        className="flex flex-col gap-3 rounded-card bg-ink p-5 text-on-ink"
      >
        <Logo tone="dark" decorative />
        <p id="acceso-marca" className="font-display text-2xl leading-tight font-extrabold">
          {BRAND.tagline}
        </p>
        <p className="text-sm text-on-ink-muted">
          Leemos cada oferta contra tu perfil y te decimos por qué sí y por qué no. Vos decidís.
        </p>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm text-on-ink-muted">
          <li className="flex gap-2">
            <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-pill bg-brand" />
            <span>
              Beta cerrada: abre el <strong className="text-on-ink">{BETA_OPENING_LABEL}</strong>.
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-pill bg-brand" />
            <span>{BETA_CAREERS_TEXT}</span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-pill bg-brand" />
            <span>El cupo es limitado: anotarte no garantiza un lugar.</span>
          </li>
        </ul>
      </section>
      <h1 className="text-title font-bold">Pedir acceso</h1>
      {/* La frase introductoria vive en el formulario: desaparece cuando el pedido se envió */}
      <Suspense fallback={null}>
        <WaitlistForm
          groups={groups}
          contact={contactLink("Borrar mis datos de la lista de espera")}
        />
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
