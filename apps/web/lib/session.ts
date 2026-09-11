import { redirect } from "next/navigation";
import { auth } from "@/auth";

/** users.id de la sesión actual; sin sesión redirige a /login (el middleware ya lo hace, esto es el cinturón). */
export async function requireUserId(): Promise<string> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) redirect("/login");
  return id;
}
