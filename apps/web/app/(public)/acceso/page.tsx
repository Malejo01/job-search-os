import type { Metadata } from "next";
import Link from "next/link";
import { ROLE_KEYS } from "@job-search-os/pipeline";
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
  const roles = ROLE_KEYS.map((key) => ({ key, label: ROLE_SKILLS[key].label }));
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-10">
      <h1 className="text-2xl font-semibold">Pedir acceso</h1>
      {/* La frase introductoria vive en el formulario: desaparece cuando el pedido se envió */}
      <WaitlistForm roles={roles} contact={contactLink("Borrar mis datos de la lista de espera")} />
      <p className="text-sm">
        <Link href="/login" className="underline">
          Ya tengo cuenta
        </Link>
      </p>
    </div>
  );
}
