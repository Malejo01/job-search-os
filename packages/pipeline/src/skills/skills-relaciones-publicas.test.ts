import { describe, expect, it } from "vitest";
import roleSkillsSeed from "../../../db/seeds/role_skills.json";
import skills from "../../../db/seeds/skills.json";
import { roleSkillsSchema } from "./self-assessment";

/** R6-5: skills propias de relaciones públicas (todo inventado, sin datos de personas). */
const NEW_SLUGS = [
  "crisis_management",
  "event_management",
  "protocol_etiquette",
  "influencer_relations",
];
const roleSkills = roleSkillsSchema.parse(roleSkillsSeed);
const bySlug = new Map((skills as { slug: string; category: string }[]).map((s) => [s.slug, s]));

describe("skills de relaciones públicas (R6-5)", () => {
  it("las 4 nuevas existen en la taxonomía, de dominio", () => {
    for (const slug of NEW_SLUGS) expect(bySlug.get(slug)?.category, slug).toBe("dominio");
  });

  it("están enganchadas a relaciones_publicas", () => {
    for (const slug of NEW_SLUGS) expect(roleSkills.relaciones_publicas.skills).toContain(slug);
  });

  it("no se agregan a otra carrera de la beta por accidente", () => {
    for (const [role, entry] of Object.entries(roleSkills)) {
      if (role === "relaciones_publicas") continue;
      for (const slug of NEW_SLUGS) expect(entry.skills, `${role}: ${slug}`).not.toContain(slug);
    }
  });

  it("mantiene las skills de prensa y comunicación que ya tenía", () => {
    expect(roleSkills.relaciones_publicas.skills).toEqual(
      expect.arrayContaining(["press_relations", "corporate_communications", "public_affairs"]),
    );
  });
});
