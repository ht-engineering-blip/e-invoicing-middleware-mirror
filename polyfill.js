// Workaround for oven-sh/bun#32501 (fixed on main, not yet released):
// bson calls process.getBuiltinModule('v8').startupSnapshot.isBuildingSnapshot()
// at import time. Bun's stub throws instead of returning false. Intercept it here,
// before mongoose/mongodb/bson load, and return a working stub. Safe to remove
// once a Bun release includes the upstream fix.
if (typeof process !== "undefined" && typeof process.getBuiltinModule === "function") {
  const originalGetBuiltinModule = process.getBuiltinModule.bind(process);
  process.getBuiltinModule = function (name) {
    if (name === "v8") {
      const mod = originalGetBuiltinModule(name);
      return new Proxy(mod ?? {}, {
        get(target, prop, receiver) {
          if (prop === "startupSnapshot") {
            return {
              isBuildingSnapshot: () => false,
              addSerializeCallback: () => {},
              addDeserializeCallback: () => {},
              setDeserializeMainFunction: () => {},
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      });
    }
    return originalGetBuiltinModule(name);
  };
}

if (typeof globalThis.process.getBuiltinModule !== 'function') {
  globalThis.process.getBuiltinModule = (id) => require(id.startsWith('node:') ? id : `node:${id}`);
}
