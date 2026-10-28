// satori/standalone embeds its HarfBuzz module as a base64 string and compiles it from
// bytes at runtime, which Cloudflare Workers forbid. Extract it to a real .wasm file so the
// Worker can import it as a precompiled WebAssembly.Module (see src/wasm-shim.ts).
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(resolve(root, "node_modules/satori/dist/standalone.js"), "utf8");
const candidates = src.match(/"[A-Za-z0-9+/]{100000,}={0,2}"/g) ?? [];
if (candidates.length !== 1) {
  throw new Error(`expected exactly one embedded wasm in satori/standalone, found ${candidates.length}`);
}
const bytes = Buffer.from(candidates[0].slice(1, -1), "base64");
if (bytes.readUInt32BE(0) !== 0x0061736d) throw new Error("embedded blob is not a wasm module");
mkdirSync(resolve(root, "src/wasm"), { recursive: true });
writeFileSync(resolve(root, "src/wasm/hb.wasm"), bytes);
console.log(`wrote src/wasm/hb.wasm (${bytes.length} bytes)`);

// emscripten's addFunction() builds tiny trampoline modules with `new WebAssembly.Module(bytes)`,
// which workerd also forbids once a request is in flight. Emit the exact bytes it would compile
// so they can be imported as precompiled modules too.
const trampolines = {
  "trampoline-v-i.wasm": [0,97,115,109,1,0,0,0,1,135,0,1,96,129,0,127,128,0,2,7,1,1,101,1,102,0,0,7,5,1,1,102,0,0],
};
for (const [name, body] of Object.entries(trampolines)) {
  writeFileSync(resolve(root, "src/wasm", name), Uint8Array.from(body));
  console.log(`wrote src/wasm/${name}`);
}
