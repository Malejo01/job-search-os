import { assertLocalTestEnv } from "./test-guard";

// setupFiles de la config de integración: corre antes de cada archivo de test, antes de conectar
assertLocalTestEnv();
