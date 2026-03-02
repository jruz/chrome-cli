import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      "@typescript-eslint/consistent-type-assertions": ["warn", {
        assertionStyle: "never",
      }],
    },
  },
  {
    ignores: ["dist/", "node_modules/"],
  },
);
