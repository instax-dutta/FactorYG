import { register } from "node:module";

export async function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
    return nextResolve(specifier, context);
  }

  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND" || specifier.endsWith(".ts")) {
      throw error;
    }
    return await nextResolve(`${specifier}.ts`, context);
  }
}

register(import.meta.url);
