console.log("[Bun Patch] Initializing node:v8 workaround...");
if (globalThis?.process?.getBuiltinModule) {
  const original = globalThis.process.getBuiltinModule;
  globalThis.process.getBuiltinModule = function (name: string) {
    if (name === "v8") {
      return {}; // BSON expects startupSnapshot here, returning {} avoids the NotImplementedError
    }
    return original.call(globalThis.process, name);
  };
  console.log("[Bun Patch] Successfully applied node:v8 workaround");
}
