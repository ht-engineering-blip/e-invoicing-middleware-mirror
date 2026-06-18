if (typeof globalThis.process.getBuiltinModule !== 'function') {
  globalThis.process.getBuiltinModule = (id) => require(id.startsWith('node:') ? id : `node:${id}`);
}
