import { getFileSizeInBytes, type FileSize } from "./utils/helpers";
import type { RouteConfig } from "./router-types";
import type { MimeLiteral, MimeWildcard } from "./utils/mime-literals.generated";

export type CustomMimeLiteral = string & { readonly __uploadStuffCustomMime: "custom" };
type KnownFileTypeKey = "blob" | MimeLiteral | MimeWildcard;
export type FileTypeKey = KnownFileTypeKey | CustomMimeLiteral;

export type PerTypeConfig = {
  maxFileSize?: FileSize;
  maxFileCount?: number;
};

export type FilesRecord = Partial<Record<KnownFileTypeKey, PerTypeConfig>> &
  Partial<Record<CustomMimeLiteral, PerTypeConfig>>;
export type FilesConfig = readonly FileTypeKey[] | FilesRecord;

export type NormalizedFileTypeKey = MimeLiteral | MimeWildcard | CustomMimeLiteral | "blob";
export type NormalizedPerTypeConfig = {
  maxFileSize: FileSize;
  maxFileCount?: number;
};
export type NormalizedFilesConfig = Partial<
  Record<MimeLiteral | MimeWildcard | "blob", NormalizedPerTypeConfig>
> &
  Partial<Record<CustomMimeLiteral, NormalizedPerTypeConfig>>;

export type NormalizedRouteConfig = {
  isPublic: boolean;
  files: NormalizedFilesConfig;
  maxFileCount: number;
};

export type MatchedFileType = {
  key: NormalizedFileTypeKey;
  config: NormalizedPerTypeConfig;
};

export const DEFAULT_MAX_FILE_SIZE: FileSize = "4MB";
export const FALLBACK_CONTENT_TYPE = "application/octet-stream";

// RFC 6838 restricts type/subtype names to an alphanumeric-led token over a short
// punctuation set - no comma, whitespace, CR/LF, NUL, ";" or "*". Gating on this stops a
// crafted client from smuggling an "accept"-splitting comma or header-injecting control
// chars through into the DB row, the signed S3 ContentType, or the PUT Content-Type header.
const MIME_TOKEN = "[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*";
const MIME_SYNTAX = new RegExp(`^${MIME_TOKEN}/${MIME_TOKEN}$`);
const KEY_SYNTAX = new RegExp(`^${MIME_TOKEN}/(\\*|${MIME_TOKEN})$`);

// The longest registered MIME type is ~90 chars; 255 leaves headroom while capping what a
// direct caller can force us to persist/sign before the batch count check even runs.
const MAX_CONTENT_TYPE_LENGTH = 255;

// Lowercase, trim, and drop parameters - the honest canonical form used for MATCHING.
// Unlike normalizeContentType it does NOT fold malformed/empty input to the catch-all, so
// matchFileType can route an untyped or garbage content type to `blob` only, never a typed
// `type/*` or exact bucket.
export const canonicalizeContentType = (contentType: string | undefined | null): string =>
  (contentType ?? "").split(";")[0]!.trim().toLowerCase();

// Storage-safe content type for PERSISTENCE and SIGNING: the canonical form when it is a
// clean, bounded type/subtype, otherwise the catch-all. Guarantees the DB row and the signed
// S3 ContentType are always well-formed even for a crafted client. Applied at the storage
// boundary (core), never before matching.
export const normalizeContentType = (contentType: string | undefined | null): string => {
  const canonical = canonicalizeContentType(contentType);
  if (canonical.length > MAX_CONTENT_TYPE_LENGTH || !MIME_SYNTAX.test(canonical)) {
    return FALLBACK_CONTENT_TYPE;
  }
  return canonical;
};

export const customMime = (value: string): CustomMimeLiteral => {
  const normalized = value.trim().toLowerCase();
  if (!MIME_SYNTAX.test(normalized)) {
    throw new Error(
      `upload-stuff: invalid MIME type "${value}" - expected "type/subtype" without parameters.`,
    );
  }
  return normalized as CustomMimeLiteral;
};

const normalizeKey = (key: string): NormalizedFileTypeKey => {
  const normalized = key.trim().toLowerCase();
  if (normalized === "blob") return "blob";

  if (!normalized.includes("/")) {
    throw new Error(`upload-stuff: invalid file type key "${key}" - did you mean "${normalized}/*"?`);
  }

  if (!KEY_SYNTAX.test(normalized)) {
    throw new Error(
      `upload-stuff: invalid file type key "${key}" - expected "type/subtype" or "type/*".`,
    );
  }
  return normalized as NormalizedFileTypeKey;
};

const assertValidCount = (value: number | undefined, label: string): void => {
  if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
    throw new Error(`upload-stuff: ${label} must be a non-negative integer (got ${value}).`);
  }
};

const assertValidSize = (value: FileSize, label: string): void => {
  if (getFileSizeInBytes(value) <= 0) {
    throw new Error(`upload-stuff: ${label} must be greater than 0 bytes (got "${value}").`);
  }
};

export const normalizeRouteConfig = (
  config: RouteConfig,
  opts: { defaultMaxFileCount: number; defaultMaxFileSize: FileSize },
): NormalizedRouteConfig => {
  assertValidCount(opts.defaultMaxFileCount, "defaultMaxFileCount");
  assertValidSize(opts.defaultMaxFileSize, "defaultMaxFileSize");
  assertValidCount(config.maxFileCount, "maxFileCount");
  if (config.maxFileSize !== undefined) assertValidSize(config.maxFileSize, "maxFileSize");

  const entries: Array<[string, PerTypeConfig]> = Array.isArray(config.files)
    ? (config.files as readonly string[]).map((key) => [key, {}])
    : // `?? {}` folds a JS caller's null/undefined `files` into the branded
      // "at least one file type" error below instead of a raw TypeError.
      Object.entries((config.files as Record<string, PerTypeConfig | undefined> | undefined) ?? {}).map(
        ([key, value]) => [key, value ?? {}],
      );

  if (entries.length === 0) {
    throw new Error("upload-stuff: `files` must declare at least one file type.");
  }

  const files: Record<string, NormalizedPerTypeConfig> = {};
  for (const [key, perType] of entries) {
    const normalizedKey = normalizeKey(key);
    if (Object.hasOwn(files, normalizedKey)) {
      throw new Error(
        `upload-stuff: duplicate file type key - "${key}" normalizes to "${normalizedKey}", which is already declared.`,
      );
    }

    assertValidCount(perType.maxFileCount, `files["${key}"].maxFileCount`);
    const maxFileSize = perType.maxFileSize ?? config.maxFileSize ?? opts.defaultMaxFileSize;
    assertValidSize(maxFileSize, `files["${key}"].maxFileSize`);

    files[normalizedKey] = {
      maxFileSize,
      ...(perType.maxFileCount !== undefined ? { maxFileCount: perType.maxFileCount } : {}),
    };
  }

  return {
    isPublic: config.isPublic,
    files: files as NormalizedFilesConfig,
    maxFileCount: config.maxFileCount ?? opts.defaultMaxFileCount,
  };
};

export const matchFileType = (
  contentType: string,
  config: NormalizedRouteConfig,
): MatchedFileType | undefined => {
  const normalized = canonicalizeContentType(contentType);
  const files = config.files as Record<string, NormalizedPerTypeConfig | undefined>;
  // An empty, malformed, or param-laden content type isn't a strict "type/subtype", so it is
  // ineligible for exact/wildcard buckets and falls through to `blob`, the declared catch-all.
  // We match on the canonical (un-folded) value on purpose: folding it to
  // application/octet-stream first would let an untyped upload ride a typed `application/*`
  // route instead of requiring `blob`.
  const isStrictType = MIME_SYNTAX.test(normalized);

  if (isStrictType && Object.hasOwn(files, normalized)) {
    const exact = files[normalized];
    if (exact) return { key: normalized as NormalizedFileTypeKey, config: exact };
  }

  if (isStrictType) {
    const wildcardKey = `${normalized.split("/")[0]}/*`;
    if (Object.hasOwn(files, wildcardKey)) {
      const wildcard = files[wildcardKey];
      if (wildcard) return { key: wildcardKey as NormalizedFileTypeKey, config: wildcard };
    }
  }

  if (Object.hasOwn(files, "blob")) {
    const blob = files.blob;
    if (blob) return { key: "blob", config: blob };
  }

  return undefined;
};

export const getAcceptFromRouteConfig = (config: NormalizedRouteConfig): string | undefined => {
  const keys = Object.keys(config.files);
  if (keys.includes("blob")) return undefined;
  return keys.join(",");
};

const COMPRESSIBLE_RASTER_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export const isCompressibleRasterImageContentType = (contentType: string): boolean =>
  COMPRESSIBLE_RASTER_TYPES.has(normalizeContentType(contentType));
