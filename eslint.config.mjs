import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // После входа, выхода и регистрации нужна полная перезагрузка страницы,
    // чтобы сбросить состояние клиента и перечитать права с сервера.
    rules: { "@next/next/no-location-assign-relative-destination": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "dist/**",
    "variants/**",
    "scripts/**",
    "e2e/**",
  ]),
]);

export default eslintConfig;
