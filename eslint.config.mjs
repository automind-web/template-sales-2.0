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
  {
    // WhatsApp Studio перенесена из шаблона WhatsApp Agent Studio без переписывания
    // (логика проверена тестами шаблона, см. test/whatsapp-studio.test.ts).
    files: ["components/wa-studio/**", "server/wa/**/*.mjs"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/immutability": "off",
    },
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
