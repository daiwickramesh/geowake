/**
 * Runs React Native Web's runtime style validator against GeoWake's stylesheet.
 *
 * `App.tsx` builds its sheet through a loosely typed `StyleSheet.create` alias
 * because RN's types reject web-only properties (`cursor`, `transition`,
 * `boxShadow`, the long-form `outline*` properties). That cast means `tsc`
 * cannot catch a property that React Native Web rejects at runtime, and a web
 * export only bundles the module without executing it, so an invalid property
 * would otherwise only surface as a console error in the browser.
 *
 * This transpiles the stylesheet with the repo's own TypeScript, evaluates it
 * against the real theme tokens, and feeds every entry through RNW's
 * `validate()`.
 *
 * Rules enforced, straight from RNW's StyleSheet validator:
 *   - no CSS shorthands: background, border*, font, grid, outline,
 *     textDecoration
 *   - no multi-value shorthands given as strings: padding, margin, flex,
 *     borderRadius, inset*, overflow, ...
 *
 * Run with: npm run check:styles
 */
const fs = require("fs");
const path = require("path");

const clientDir = path.join(__dirname, "..");
const ts = require(path.join(clientDir, "node_modules", "typescript"));

function transpile(source, fileName) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName,
  }).outputText;
}

/** Evaluate CommonJS output in a sandbox and return its exports. */
function loadCjs(code, globals = {}) {
  const module = { exports: {} };
  const names = Object.keys(globals);
  const fn = new Function("module", "exports", "require", ...names, code);
  fn(
    module,
    module.exports,
    () => ({}),
    ...names.map((name) => globals[name]),
  );
  return module.exports;
}

/**
 * Pull the `createSheet({ ... })` argument out of App.tsx with the AST.
 * Counting braces or parens by hand desyncs on parens inside string values
 * such as `boxShadow: "0 24px 60px rgba(0,0,0,0.55)"`.
 */
function readSheetLiteral(appSource) {
  const sourceFile = ts.createSourceFile(
    "App.tsx",
    appSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  let call = null;
  (function walk(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "createSheet"
    ) {
      call = node;
      return;
    }
    ts.forEachChild(node, walk);
  })(sourceFile);

  if (!call) throw new Error("could not find a createSheet(...) call in App.tsx");
  if (call.arguments.length !== 1) {
    throw new Error(
      `expected createSheet() to take 1 argument, got ${call.arguments.length}`,
    );
  }
  return call.arguments[0].getText(sourceFile);
}

const tokens = loadCjs(
  transpile(
    fs.readFileSync(path.join(clientDir, "theme.ts"), "utf8"),
    "theme.ts",
  ),
);

const literal = readSheetLiteral(
  fs.readFileSync(path.join(clientDir, "App.tsx"), "utf8"),
);
const sheet = loadCjs(
  transpile(
    `const __sheet = createSheet(${literal});\nmodule.exports = __sheet;`,
    "sheet.ts",
  ),
  { createSheet: (styles) => styles, ...tokens },
);

const { validate } = require(path.join(
  clientDir,
  "node_modules",
  "react-native-web",
  "dist",
  "cjs",
  "exports",
  "StyleSheet",
  "validate.js",
));

const problems = [];
const originalError = console.error;
console.error = (...args) => {
  problems.push(args.join(" "));
};

const names = Object.keys(sheet);
for (const name of names) {
  const style = sheet[name];
  if (!style || typeof style !== "object") continue;

  validate(style);

  // Nested selectors are not rewritten by RNW 0.21's style preprocessor, so
  // they would emit invalid CSS. Flag them instead of letting them pass.
  for (const key of Object.keys(style)) {
    if (key.startsWith(":") || key.startsWith("&")) {
      problems.push(`sheet.${name}: nested selector "${key}" is not supported`);
    }
  }
}

console.error = originalError;

if (problems.length > 0) {
  console.error(`${problems.length} rejected style declaration(s):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(`OK: ${names.length} style entries pass react-native-web validate()`);
