import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  root,
  hash,
  files,
  inputs,
  sourceDigest,
  operationInventory,
  NAVIGATION,
  VIEWS,
} from "./screen_inputs.mjs";

const env = inputs(process.argv.slice(2));
const ts = env.require("typescript");
const options = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  strict: true,
  skipLibCheck: true,
  isolatedModules: true,
  verbatimModuleSyntax: true,
  noUnusedLocals: true,
  noUnusedParameters: true,
  noEmit: true,
  typeRoots: [join(env.toolchain, "node_modules/@types")],
};

const host = ts.createCompilerHost(options);
host.resolveModuleNames = (names, file) =>
  names.map((name) => {
    if (name === "@cadence/screen-ui") {
      return {
        resolvedFileName: join(env.kit, "types/screen-ui/src/index.d.ts"),
        extension: ts.Extension.Dts,
      };
    }
    if (name === "@cadence/app-kit") {
      return {
        resolvedFileName: join(root, "app-kit/types/index.d.ts"),
        extension: ts.Extension.Dts,
      };
    }
    if (name === "@cadence/app-kit/react") {
      return {
        resolvedFileName: join(root, "app-kit/types/react.d.ts"),
        extension: ts.Extension.Dts,
      };
    }
    if (name === "@cadence/screen-ui/styles.css") return undefined;
    return (
      ts.resolveModuleName(name, file, options, ts.sys).resolvedModule ??
      (!name.startsWith(".")
        ? ts.resolveModuleName(name, join(env.toolchain, "src/screen/__works__.tsx"), options, ts.sys)
            .resolvedModule
        : undefined)
    );
  });

const sources = files(join(root, "src/screen")).filter((p) => /\.tsx?$/.test(p));
const program = ts.createProgram(sources, options, host);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  throw new Error(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => root,
      getCanonicalFileName: (f) => f,
      getNewLine: () => "\n",
    }),
  );
}
console.log("Works strict typecheck: passed");
if (process.argv.includes("--typecheck-only")) process.exit(0);

const { build } = await import(pathToFileURL(env.require.resolve("vite")));
const { default: react } = await import(
  pathToFileURL(env.require.resolve("@vitejs/plugin-react"))
);

const operations = operationInventory();
const out = join(root, "app/screens/works");
mkdirSync(out, { recursive: true });

const globals = {
  react: "CadenceWorksRuntime.React",
  "react-dom": "CadenceWorksRuntime.ReactDOM",
  "react-dom/client": "CadenceWorksRuntime.ReactDOMClient",
  "react/jsx-runtime": "CadenceWorksRuntime.JSXRuntime",
};

for (const runtime of [true, false]) {
  await build({
    configFile: false,
    root,
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      react(),
      {
        name: "works-pinned-inputs",
        resolveId(name) {
          if (name === "@cadence/screen-ui") return join(env.kit, "index.js");
          if (name === "@cadence/screen-ui/styles.css") return join(env.kit, "styles.css");
          if (name === "@cadence/app-kit") return join(root, "app-kit/src/index.mjs");
          if (name === "@cadence/app-kit/react") return join(root, "app-kit/src/react.mjs");
          if (name === "@hugeicons/react" || name === "@hugeicons/core-free-icons") {
            const manifest = join(env.toolchain, "node_modules", name, "package.json");
            const pkg = JSON.parse(readFileSync(manifest, "utf8"));
            return join(manifest, "..", pkg.module);
          }
          if (/^(react(?:\/.*)?|react-dom(?:\/.*)?)$/.test(name)) {
            if (!runtime) {
              if (!Object.hasOwn(globals, name)) {
                throw new Error(`Unlisted framework external: ${name}`);
              }
              return { id: name, external: true };
            }
            return env.require.resolve(name);
          }
        },
        buildEnd(error) {
          if (error) return;
          for (const id of this.getModuleIds()) {
            if (id.includes("/ui/src/")) {
              throw new Error(`Host authority import escaped package: ${id}`);
            }
          }
        },
        generateBundle(_options, bundle) {
          const chunks = Object.values(bundle).filter((item) => item.type === "chunk");
          if (
            chunks.length !== 1 ||
            chunks[0].dynamicImports.length ||
            chunks[0].imports.some((id) => runtime || !Object.hasOwn(globals, id))
          ) {
            throw new Error(
              "Screen requires two static IIFEs with only closed app-local externals",
            );
          }
          const chunk = chunks[0];
          const ids = [...this.getModuleIds()];
          const framework = ids.filter((id) =>
            /\/node_modules\/(react|react-dom|scheduler)\//.test(id),
          );
          const reactRoot = framework.filter((id) =>
            id.endsWith("/react/cjs/react.production.js"),
          );
          if (runtime ? reactRoot.length !== 1 : framework.length !== 0) {
            throw new Error(
              "Framework partition must contain exactly one React implementation in runtime and none in client",
            );
          }
          const external = [...chunk.imports];
          if (
            runtime
              ? external.length !== 0
              : JSON.stringify(external.sort()) !== JSON.stringify(Object.keys(globals).sort())
          ) {
            throw new Error("Unexpected framework partition externals");
          }
          for (const id of ids) {
            const info = this.getModuleInfo(id);
            if (runtime && info?.importedIds.includes("react")) {
              throw new Error("Unresolved runtime React import");
            }
          }
          console.log(
            JSON.stringify({
              partition: runtime ? "runtime.js" : "client.js",
              format: _options.format,
              external,
              frameworkModulesCount: framework.length,
            }),
          );
        },
      },
    ],
    build: {
      outDir: out,
      emptyOutDir: runtime,
      minify: true,
      sourcemap: false,
      lib: {
        entry: join(root, runtime ? "src/screen/runtime.ts" : "src/screen/main.tsx"),
        name: runtime ? "CadenceWorksRuntime" : "CadenceWorks",
        formats: ["iife"],
        fileName: () => (runtime ? "runtime.js" : "client.js"),
        cssFileName: "works",
      },
      rolldownOptions: {
        external: runtime ? [] : Object.keys(globals),
        output: {
          codeSplitting: false,
          globals: (id) => {
            if (!Object.hasOwn(globals, id)) throw new Error(`Unlisted IIFE global: ${id}`);
            return globals[id];
          },
        },
      },
    },
  });
}

// Host bundle grammar v4 screen caps: 2 MiB per screen asset, 2 MiB total.
const SCREEN_ASSET_CAP = 2097152;
const SCREEN_TOTAL_CAP = 2097152;
const SCREEN_MANIFEST_CAP = 32768;

const assets = ["runtime.js", "client.js", "works.css"].map((name) => {
  const body = readFileSync(join(out, name));
  if (body.length > SCREEN_ASSET_CAP) {
    throw new Error(`${name}: ${body.length} exceeds ${SCREEN_ASSET_CAP}`);
  }
  return {
    name,
    media_type: name.endsWith(".js") ? "text/javascript" : "text/css",
    size: body.length,
    sha256: `sha256:${hash(body)}`,
  };
});

if (assets.reduce((n, a) => n + a.size, 0) > SCREEN_TOTAL_CAP) {
  throw new Error(`Screen total exceeds ${SCREEN_TOTAL_CAP} bytes`);
}

const decl = {
  contract: "app-screens/v2",
  app: "works",
  entry: "client.js",
  startup: ["runtime.js", "client.js"],
  assets,
  provenance: {
    source_digest: `sha256:${sourceDigest()}`,
    sdk_digest: `sha256:${env.pin.archive.sha256}`,
    toolchain_digest: `sha256:${hash(JSON.stringify(env.pin.toolchain))}`,
  },
  host_contract: "screen-records.v1",
  may: ["records.call", "records.slot"],
  tools: {},
  operations,
  navigation: NAVIGATION,
  views: VIEWS,
};

const declaration = JSON.stringify(decl, null, 2) + "\n";
if (Buffer.byteLength(declaration) > SCREEN_MANIFEST_CAP) {
  throw new Error(`Screen declaration exceeds ${SCREEN_MANIFEST_CAP} bytes`);
}
writeFileSync(join(out, "screens.json"), declaration);
console.log(
  JSON.stringify(
    {
      development: env.dev,
      sdk: env.pin.archive,
      assets,
      total: assets.reduce((n, a) => n + a.size, 0),
    },
    null,
    2,
  ),
);
