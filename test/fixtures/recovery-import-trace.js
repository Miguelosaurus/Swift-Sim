import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, nextResolve) {
  if (/deliveryRecovery(?:Runtime)?\.js$/.test(specifier)) process.stderr.write("RECOVERY_MODULE_LOADED\n");
  return nextResolve(specifier, context);
} });
