import { describe, expect, it } from "vitest";
import { inferSeniorityFromTitle } from "./seniority";

describe("inferSeniorityFromTitle", () => {
  it.each([
    ["Software Intern", "Trainee"],
    ["Internship Program Assistant", "Trainee"],
    ["Trainee de Sistemas", "Trainee"],
    ["Pasante de Soporte", "Trainee"],
    ["Practicante de Datos", "Trainee"],
    ["Junior Analyst", "Junior"],
    ["Jr. Developer", "Junior"],
    ["Entry Level Designer", "Junior"],
    ["Desarrollador Semi Senior", "Semi Senior"],
    ["Desarrollador Semisenior", "Semi Senior"],
    ["Analista SSR", "Semi Senior"],
    ["Mid Level Engineer", "Semi Senior"],
    ["Mid Engineer", "Semi Senior"],
    ["Intermediate Tester", "Semi Senior"],
    ["Senior Analyst", "Senior"],
    ["Sr. Analyst", "Senior"],
    ["Analista Sr", "Senior"],
    ["Lead Designer", "Lead"],
    ["Staff Engineer", "Lead"],
    ["Staff Software Engineer", "Lead"],
    ["Principal Architect", "Lead"],
    ["Tech Lead", "Lead"],
  ])("%s → %s", (title, expected) => {
    expect(inferSeniorityFromTitle(title)).toBe(expected);
  });

  it("no distingue mayúsculas ni acentos", () => {
    expect(inferSeniorityFromTitle("SENIOR ANALYST")).toBe("Senior");
    expect(inferSeniorityFromTitle("Líder Técnico Sénior")).toBe("Senior");
  });

  it("'Semi Senior' no suma también 'Senior'", () => {
    expect(inferSeniorityFromTitle("Semi-Senior Analyst")).toBe("Semi Senior");
  });

  it("sin nivel o con falsos amigos → null", () => {
    expect(inferSeniorityFromTitle("Data Analyst")).toBeNull();
    expect(inferSeniorityFromTitle("Lead Generation Specialist")).toBeNull();
    expect(inferSeniorityFromTitle("Lead Gen Manager")).toBeNull();
    expect(inferSeniorityFromTitle("Leads Coordinator")).toBeNull();
    expect(inferSeniorityFromTitle("Mid-Market Account Executive")).toBeNull();
    expect(inferSeniorityFromTitle("Mid Market Account Executive")).toBeNull();
    expect(inferSeniorityFromTitle("Staffing Coordinator")).toBeNull();
    expect(inferSeniorityFromTitle("Internal Tools Analyst")).toBeNull();
  });

  it("varios niveles: ascendente, unidos con ' / ' y sin repetidos", () => {
    expect(inferSeniorityFromTitle("Junior/Mid Developer")).toBe("Junior / Semi Senior");
    expect(inferSeniorityFromTitle("Senior or Lead Analyst")).toBe("Senior / Lead");
    expect(inferSeniorityFromTitle("Lead / Junior Analyst")).toBe("Junior / Lead");
    expect(inferSeniorityFromTitle("Senior Sr Analyst")).toBe("Senior");
    // Documentado: "Senior Staff" y "Mid-Senior" nombran dos niveles
    expect(inferSeniorityFromTitle("Senior Staff Engineer")).toBe("Senior / Lead");
    expect(inferSeniorityFromTitle("Mid-Senior Developer")).toBe("Semi Senior / Senior");
  });

  it("staff y principal sin rol técnico no son Lead", () => {
    expect(inferSeniorityFromTitle("Staff Accountant")).toBeNull();
    expect(inferSeniorityFromTitle("Principal Accountant")).toBeNull();
  });
});
