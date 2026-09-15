import * as fs from "fs";
import * as path from "path";

if (typeof process !== "undefined" && typeof process.getBuiltinModule === "function") {
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

// Ensure .env is loaded regardless of current working directory
const envCandidates = [
  path.join(__dirname, ".env"),
  path.join(process.cwd(), ".env"),
  path.join(process.cwd(), "e-invoicing-middleware", ".env"),
];

for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
    break;
  }
}

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = "test-jwt-secret-key-32-characters-long!";
}
if (!process.env.JWT_EXPIRES_IN) {
  process.env.JWT_EXPIRES_IN = "1d";
}
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "test";
}


