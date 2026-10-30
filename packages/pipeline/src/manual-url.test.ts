import { describe, expect, it } from "vitest";
import { parseManualUrl } from "./manual-url";

describe("parseManualUrl: rangos reservados (S-2 del verificador de links, T7)", () => {
  const rejected = (url: string) => expect(parseManualUrl(url)).toEqual({ ok: false });

  it("rechaza las redes de documentación y reservadas de IPv4", () => {
    rejected("http://192.0.0.8/");
    rejected("http://192.0.2.10/");
    rejected("http://198.51.100.7/");
    rejected("http://203.0.113.1/");
    rejected("http://192.88.99.1/");
    rejected("http://240.0.0.1/");
  });

  it("deja pasar IPv4 públicas vecinas de esos rangos", () => {
    expect(parseManualUrl("http://192.0.3.1/")).toMatchObject({ ok: true });
    expect(parseManualUrl("http://198.51.101.1/")).toMatchObject({ ok: true });
    expect(parseManualUrl("http://203.0.114.1/")).toMatchObject({ ok: true });
  });

  it("NAT64 y 6to4 se juzgan por la IPv4 que llevan adentro", () => {
    rejected("http://[64:ff9b::a00:1]/"); // 10.0.0.1
    rejected("http://[64:ff9b::7f00:1]/"); // 127.0.0.1
    rejected("http://[2002:a00:1::]/"); // 6to4 de 10.0.0.1
    rejected("http://[2002:c0a8:101::1]/"); // 6to4 de 192.168.1.1
    rejected("http://[2002:7f00:1:1::]/"); // 6to4 de 127.0.0.1, con el grupo 3 distinto de cero
    rejected("http://[64:ff9b::10.0.0.1]/"); // forma punteada: URL la normaliza a hex
    expect(parseManualUrl("http://[64:ff9b::808:808]/")).toMatchObject({ ok: true }); // 8.8.8.8
    expect(parseManualUrl("http://[2002:808:808::1]/")).toMatchObject({ ok: true });
  });

  it("rechaza Teredo y el NAT64 local", () => {
    rejected("http://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/");
    rejected("http://[64:ff9b:1::1]/");
  });
});

describe("parseManualUrl", () => {
  it("vacío es válido y queda null", () => {
    expect(parseManualUrl("")).toEqual({ ok: true, url: null });
    expect(parseManualUrl("   ")).toEqual({ ok: true, url: null });
  });

  it.each([
    ["https://empresa-a.example.com", "https://empresa-a.example.com/"],
    [
      "https://portal.example.com/jobs/123?utm=x&ref=y",
      "https://portal.example.com/jobs/123?utm=x&ref=y",
    ],
    ["http://empresa-a.example.com/careers", "http://empresa-a.example.com/careers"],
    ["https://8.8.8.8/x", "https://8.8.8.8/x"],
    ["https://172.32.0.1/", "https://172.32.0.1/"],
    ["https://[2606:4700::1111]/", "https://[2606:4700::1111]/"],
  ])("acepta %s", (input, href) => {
    expect(parseManualUrl(input)).toEqual({ ok: true, url: href });
  });

  it.each([
    "no es una url",
    "empresa-a.example.com",
    "ftp://empresa-a.example.com/x",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "data:text/html,hola",
    "https://user@empresa-a.example.com/",
    "https://user:clave@empresa-a.example.com/",
    "http://localhost/",
    "http://localhost:3000/",
    "http://app.localhost/",
    "http://servidor.local/",
    "http://api.internal/",
    "http://router.lan/",
    "http://nas.home/",
    "http://wiki.corp/",
    "http://portal.intranet/",
    "http://servidor/",
    "http://0.0.0.0/",
    "http://10.0.0.1/",
    "http://100.64.0.1/",
    "http://100.127.255.255/",
    "http://127.0.0.1/",
    "http://127.1.2.3/",
    "http://169.254.169.254/latest/meta-data",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.168.1.1/",
    "http://198.18.0.1/",
    "http://198.19.255.1/",
    "http://224.0.0.1/",
    "http://240.0.0.1/",
    "http://255.255.255.255/",
    "http://2130706433/",
    "http://0x7f.1/",
    "http://0x7f000001/",
    "http://017700000001/",
    "http://[::]/",
    "http://[::1]/",
    "http://[fc00::1]/",
    "http://[fd12:3456::1]/",
    "http://[fe80::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:10.1.2.3]/",
    "http://[::ffff:192.168.0.1]/",
    "http://[::ffff:169.254.169.254]/",
    "http://[2001:db8::1]/",
  ])("rechaza %s", (input) => {
    expect(parseManualUrl(input)).toEqual({ ok: false });
  });

  it("rechaza más de 2000 caracteres", () => {
    const largo = `https://empresa-a.example.com/${"a".repeat(2000)}`;
    expect(parseManualUrl(largo)).toEqual({ ok: false });
    const justo = `https://empresa-a.example.com/${"a".repeat(2000 - 30)}`;
    expect(parseManualUrl(justo).ok).toBe(true);
  });
});
