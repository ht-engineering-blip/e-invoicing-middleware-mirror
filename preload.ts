const v8 = globalThis?.process?.getBuiltinModule?.('v8');
if (v8) {
  if (!v8.startupSnapshot) {
    // @ts-ignore
    v8.startupSnapshot = {};
  }
  v8.startupSnapshot.isBuildingSnapshot = () => false;
}
