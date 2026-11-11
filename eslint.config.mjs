import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 참고용 원본 Apps Script 코드
    "legacy/**",
    // 원본에서 거의 그대로 옮긴 교사 화면 스크립트 (브라우저 시험으로 검증)
    "public/teacher-app/**",
  ]),
]);

export default eslintConfig;
