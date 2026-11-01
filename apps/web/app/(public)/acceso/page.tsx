import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BETA_ROLE_KEYS, selectableRoleGroups } from "@job-search-os/pipeline";
import { contactLink } from "@/lib/contact";
import { ROLE_SKILLS } from "@/lib/skill-levels";
import { WaitlistForm } from "./waitlist-form";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: { absolute: "Pedir acceso" },
  description:
    "La beta es por invitación. Dejá tu nombre, email y carrera y te avisamos cuando haya lugar.",
  alternates: { canonical: "/acceso" },
};

export default function AccesoPage() {
  // La lista de espera ofrece las carreras de la beta aunque sigan ocultas en los selectores (ADR-027):
  // quien se anota el 11/11 tiene que poder elegir la suya.
  const groups = selectableRoleGroups(BETA_ROLE_KEYS).map((group) => ({
    label: group.label,
    roles: group.roles.map((key) => ({ key, label: ROLE_SKILLS[key].label })),
  }));
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-10">
      <h1 className="text-2xl font-semibold">Pedir acceso</h1>
      {/* La frase introductoria vive en el formulario: desaparece cuando el pedido se envió */}
      <Suspense fallback={null}>
        <WaitlistForm
          groups={groups}
          contact={contactLink("Borrar mis datos de la lista de espera")}
        />
      </Suspense>
      <p className="text-sm">
        <Link href="/login" className="underline underline-offset-2 hover:text-fg">
          Ya tengo cuenta
        </Link>
      </p>
    </div>
  );
}
