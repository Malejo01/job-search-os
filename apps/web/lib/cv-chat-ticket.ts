// El ticket y el chequeo de Origin viven en adapters (con sus tests); acá solo se reexportan para la app.
export { originAllowed, signCvTicket, verifyCvTicket } from "@job-search-os/adapters";
