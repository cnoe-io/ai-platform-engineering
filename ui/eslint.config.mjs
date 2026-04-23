import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

/**
 * Next.js 16+ ships flat ESLint presets — import directly (no FlatCompat).
 * `next lint` was removed; use `npm run lint` → `eslint .`.
 * @see https://nextjs.org/docs/app/api-reference/config/eslint
 */
const eslintConfig = [
  ...nextCoreWebVitals,
  // Jest mocks use anonymous `forwardRef` / arrow components; naming every mock is noisy.
  {
    files: ["**/*.test.{ts,tsx}", "**/__tests__/**/*.{ts,tsx}"],
    rules: {
      "react/display-name": "off",
    },
  },
];
export default eslintConfig;
