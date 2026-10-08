import { redirect } from "next/navigation";

// El layout de (app) consulta la base: sin esto Next la prerenderiza en el build, donde no hay DATABASE_URL.
export const dynamic = "force-dynamic";

// La página pública vive en /legal/privacidad (JS-106). next.config.ts ya redirige esta URL;
// este archivo queda como cinturón hasta que se pueda borrar.
export default function PrivacidadPage(): never {
  redirect("/legal/privacidad");
}
