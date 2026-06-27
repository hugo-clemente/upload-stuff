import type { FieldsDeclaration } from "@upload-stuff/core";

/**
 * Filter a resolver's output down to the declared field keys. The fields
 * declaration is the authoritative persisted shape, so a stray/typo key can't
 * be forwarded as an unknown column and a value can never collide with a
 * library-owned column. Shared by both upload paths (presigned init in the
 * core, direct `serverUtils.uploadFile`) so the rule lives in exactly one place.
 */
export const pickDeclaredFields = (
  fields: FieldsDeclaration | undefined,
  values: Record<string, unknown>,
): Record<string, unknown> => {
  const declared = Object.keys(fields ?? {});
  return Object.fromEntries(Object.entries(values).filter(([key]) => declared.includes(key)));
};
