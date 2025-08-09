import eslint from "@eslint/js";
import prettierPlugin from "eslint-plugin-prettier";
import unusedImportsPlugin from "eslint-plugin-unused-imports";
import prettierExtends from "eslint-config-prettier";
import { fixupPluginRules } from "@eslint/compat";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "client/cypress/plugins/index.js",
      ".lintstagedrc.js",
      "public/js/*",
      "runs/*",
      ".yarn/*",
      "dist/*",
      ".next/*",
      "webapp/.next/*",
      "webapp/node_modules/*",
      ".yarn/js/*",
      "ui/out/**/*",
      "electron/build/**/*",
      "public/*.js",
      "public/*.map",
    ],
  },
  {
    extends: [
      prettierExtends,
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    plugins: {
      prettierPlugin,
      "unused-imports": fixupPluginRules(unusedImportsPlugin),
    },
    rules: {
      "@typescript-eslint/restrict-template-expressions": "off",
      "no-constant-condition": ["error", { checkLoops: false }],
      "@typescript-eslint/ban-types": "off",
      "no-prototype-builtins": "off",
      "no-html-link-for-pages": "off",
      "@typescript-eslint/no-use-before-define": "off",
      "prefer-const": "error",
      curly: ["error", "all"],
      "@typescript-eslint/no-base-to-string": "off",
      "no-async-promise-executor": "off",
      "@typescript-eslint/no-this-alias": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-empty": "off",
      "no-case-declarations": "off",
      "no-control-regex": "off",
      "@typescript-eslint/no-namespace": "off",
      "@typescript-eslint/no-empty-interface": "off",
      "@typescript-eslint/consistent-type-definitions": ["error", "interface"],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
        },
      ],
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/prefer-nullish-coalescing": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "unused-imports/no-unused-imports": "error",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "object-shorthand": "error",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
