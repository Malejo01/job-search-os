import "next-auth";
import "next-auth/jwt";

// Versión de sesión (S-6): el login la guarda en el JWT y la sesión la expone a requireUserId
declare module "next-auth" {
  interface User {
    sessionVersion?: number;
  }
  interface Session {
    sessionVersion?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    sv?: number;
  }
}
