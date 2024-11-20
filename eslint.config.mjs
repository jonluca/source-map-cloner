import eslint from "@eslint/js";
import prettierPlugin from "eslint-plugin-prettier";
import unusedImportsPlugin from "eslint-plugin-unused-imports";
import prettierExtends from "eslint-config-prettier";
import { fixupPluginRules } from "@eslint/compat";
import globals from "globals";
import tseslint from "typescript-eslint";

const globalToUse = {
  ...globals.browser,
  ...globals.serviceworker,
  ...globals.es2021,
  ...globals.worker,
  ...globals.node,
};

export default tseslint.config({
  extends: [
    {
      ignores: [
        "client/cypress/plugins/index.js",
        ".lintstagedrc.js",
        "public/js/*",
        ".yarn/js/*",
        "ui/out/**/*",
        "electron/build/**/*",
        "public/*.js",
        "public/*.map",
      ],
    },
    prettierExtends,
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
  ],
  plugins: {
    prettierPlugin,
    "unused-imports": fixupPluginRules(unusedImportsPlugin),
  },
  rules: {
    "no-constant-condition": ["error", { checkLoops: false }],
    "@typescript-eslint/ban-types": "off",
    "no-prototype-builtins": "off",
    "no-html-link-for-pages": "off",
    "@typescript-eslint/no-use-before-define": "off",
    "prefer-const": "error",
    curly: ["error", "all"],
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
    "@typescript-eslint/no-explicit-any": "off",
    "unused-imports/no-unused-imports": "error",
    "object-shorthand": "error",
    "@typescript-eslint/no-unused-vars": [
      "warn",
      {
        varsIgnorePattern: "^_",
        argsIgnorePattern: "^_",
        ignoreRestSiblings: true,
      },
    ],
  },
  languageOptions: {
    globals: globalToUse,
    parserOptions: {
      ecmaFeatures: {
        jsx: true,
      },
    },
  },
});
