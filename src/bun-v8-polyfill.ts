console.log("POLYFILL: Initializing...");
if (
  typeof process !== "undefined" &&
  typeof process.getBuiltinModule === "function"
) {
  const originalGetBuiltinModule = process.getBuiltinModule.bind(process);
  process.getBuiltinModule = function (name: string) {
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
