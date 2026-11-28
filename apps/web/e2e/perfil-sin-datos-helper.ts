import * as s from "@job-search-os/db/schema";
import { eq } from "drizzle-orm";
import { E2E_USER_ID, ownerDb } from "./helpers";

/**
 * Deja sin cargar los años de experiencia y el inglés del perfil de la persona e2e y devuelve cómo
 * restaurarlos. Motivo (R33-12): al mostrar una oferta, la tabla de requisitos superpone los datos de HOY
 * del perfil a la foto de la evaluación (`withCurrentProfileFacts`: años por número, inglés por CEFR). El
 * seed del CI (`profile.example.json`) trae `years_total: 5` y `english_cefr: "B2"`, así que una fila
 * «5 años» o «Inglés avanzado» que el test arma como «Sin confirmar» sale resuelta («Coincide» o «No
 * coincide»). Los specs que prueban «Sin confirmar» de esas dos filas no pueden asumir un perfil vacío:
 * lo dejan vacío ellos y lo restauran al terminar.
 */
export async function blankProfileFacts(): Promise<() => Promise<void>> {
  const { db, close } = ownerDb();
  try {
    const [row] = await db
      .select({ years: s.profiles.yearsTotal, english: s.profiles.englishCefr })
      .from(s.profiles)
      .where(eq(s.profiles.userId, E2E_USER_ID));
    await db
      .update(s.profiles)
      .set({ yearsTotal: null, englishCefr: null })
      .where(eq(s.profiles.userId, E2E_USER_ID));
    return async () => {
      const { db: db2, close: close2 } = ownerDb();
      try {
        await db2
          .update(s.profiles)
          .set({ yearsTotal: row?.years ?? null, englishCefr: row?.english ?? null })
          .where(eq(s.profiles.userId, E2E_USER_ID));
      } finally {
        await close2();
      }
    };
  } finally {
    await close();
  }
}
