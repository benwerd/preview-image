import hbWasm from "./wasm/hb.wasm";
import trampolineVI from "./wasm/trampoline-v-i.wasm";

// satori/standalone bundles HarfBuzz as base64 and compiles it from bytes at runtime, and its
// emscripten glue compiles small trampoline modules the same way. workerd forbids compiling
// WebAssembly from bytes ("Wasm code generation disallowed by embedder") once a request is in
// flight, so hand it precompiled modules instead (see scripts/extract-hb-wasm.mjs).
// This module must be imported before "satori/standalone".
const NativeModule = WebAssembly.Module;
const nativeInstantiate = WebAssembly.instantiate.bind(WebAssembly) as (a: unknown, b?: WebAssembly.Imports) => Promise<unknown>;

const key = (bytes: Uint8Array) => bytes.join(",");
const precompiled = new Map<string, WebAssembly.Module>([
  [key(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 135, 0, 1, 96, 129, 0, 127, 128, 0, 2, 7, 1, 1, 101, 1, 102, 0, 0, 7, 5, 1, 1, 102, 0, 0])), trampolineVI],
]);

function bytesOf(source: BufferSource): Uint8Array {
  return ArrayBuffer.isView(source)
    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    : new Uint8Array(source);
}

function PatchedModule(this: unknown, source: BufferSource): WebAssembly.Module {
  return precompiled.get(key(bytesOf(source))) ?? new NativeModule(source);
}
PatchedModule.prototype = NativeModule.prototype;
PatchedModule.customSections = NativeModule.customSections;
PatchedModule.imports = NativeModule.imports;
PatchedModule.exports = NativeModule.exports;
(WebAssembly as { Module: unknown }).Module = PatchedModule;

(WebAssembly as { instantiate: unknown }).instantiate = async (source: unknown, imports?: WebAssembly.Imports) => {
  if (source instanceof NativeModule) return nativeInstantiate(source, imports);
  // The only bytes satori compiles through instantiate() are its embedded HarfBuzz module.
  const instance = (await nativeInstantiate(hbWasm, imports)) as WebAssembly.Instance;
  return { instance, module: hbWasm };
};

// The emscripten glue sees WorkerGlobalScope and reads self.location.href, which workerd lacks.
const scope = globalThis as unknown as { location?: unknown };
if (scope.location === undefined) scope.location = { href: "file:///" };
