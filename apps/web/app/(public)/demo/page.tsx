import type { Metadata } from "next";
import Link from "next/link";
import { publicOpenGraph } from "@/lib/public-og";
import { DEMO_OFFERS, DEMO_PERSON } from "@/lib/demo-contaduria";

// Un solo ejemplo fijo (el de contaduría), sin base ni IA: la página se arma una vez en el build.
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Demo: así se ve para alguien de contaduría",
  description:
    "Un ejemplo con datos inventados: el perfil de una contadora, sus ofertas con puntaje, lo que tiene a favor y lo que le falta, y cómo completar una oferta sin descripción.",
  alternates: { canonical: "/demo" },
  openGraph: publicOpenGraph({ path: "/demo" }),
};

/**
 * Entrada de la demo (R5-C7): muestra el mismo ejemplo que `/demo/contaduria` y que el video
 * (`docs/beta/voces-jovenes/guion-demo.md`): una contadora inventada, sus ofertas con puntaje, por qué
 * sí y por qué no. Los perfiles de tecnología (`/demo/[perfil]`) siguen existiendo por URL pero ya no
 * se ofrecen acá: la beta es para ocho carreras y el ejemplo tiene que contar lo mismo en todos lados.
 */
export default function DemoPage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Demo: así se ve para alguien de contaduría</h1>
        <p className="max-w-2xl text-base text-fg-muted">
          Un ejemplo con {DEMO_PERSON.name}, una persona inventada: su perfil, sus{" "}
          {DEMO_OFFERS.length} ofertas con puntaje de 1 a 10, qué tiene a favor, qué le falta y cómo
          completar una oferta que llegó sin descripción.
        </p>
      </header>
      <Link
        href="/demo/contaduria"
        // Sin prefetch (e2e 55): se pide solo al tocarla
        prefetch={false}
        data-testid="demo-contaduria-link"
        className="flex flex-col gap-1 rounded-container bg-ink p-4 text-on-ink hover:bg-ink/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:p-5"
      >
        <span className="text-xs font-bold tracking-wide text-on-ink-muted uppercase">
          Ejemplo con datos inventados
        </span>
        <span className="font-display text-lg font-extrabold">
          Así se ve para alguien de contaduría
        </span>
        <span className="text-sm text-on-ink-muted">
          Perfil, ofertas con puntaje, por qué sí y por qué no, y una oferta sin descripción.
        </span>
      </Link>
      <p className="text-sm text-fg-muted">
        <Link
          href="/acceso"
          className="inline-flex min-h-11 items-center underline underline-offset-2 hover:text-fg"
        >
          ¿Querés verlo con tu perfil? Pedir acceso (el cupo de la beta es limitado)
        </Link>
      </p>
    </div>
  );
}
