import * as AWS from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type {
  AdapterTypeInfo,
  FieldsDeclaration,
  InferFieldValues,
  ObjectMetadataInput,
  ObjectMetadataResolver,
  StorageAdapter,
  StorageObjectInfo,
} from "@upload-stuff/core";

/**
 * S3 {@link StorageAdapter} factory. Uploads go browser → S3 via presigned PUTs.
 * Pass to `UploadStuff({ storageAdapter })`; `objectMetadata` is typed against
 * the instance's declared `fields`. Works with any S3-compatible store (R2, MinIO).
 *
 * @example
 * s3Adapter({
 *   config: { region: "us-east-1", credentials: { accessKeyId, secretAccessKey } },
 *   bucket: "uploads",
 * })
 */
export const s3Adapter =
  <
    TFields extends FieldsDeclaration = Record<never, never>,
  >(params: {
    config: AWS.S3ClientConfig;
    bucket: string;
    /**
     * Resolve S3 object metadata (`x-amz-meta-*`) from each row, typed against the
     * instance's declared `fields`. Returns a flat string map written as object
     * metadata. Defaults to none.
     */
    objectMetadata?: ObjectMetadataResolver<TFields>;
  }) =>
  (_info: AdapterTypeInfo<TFields>): StorageAdapter => {
  const s3Client = new AWS.S3Client(params.config);
  const bucket = params.bucket;

  const fileExists = async (key: string): Promise<boolean> => {
    const command = new AWS.HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    try {
      await s3Client.send(command);
      return true;
    } catch (error) {
      // HeadObject reports a missing key as `NotFound` / HTTP 404 — `NoSuchKey`
      // is a GetObject-only error code and never appears here.
      if (
        error instanceof AWS.S3ServiceException &&
        (error.name === "NotFound" ||
          error.name === "NoSuchKey" ||
          error.$metadata?.httpStatusCode === 404)
      ) {
        return false;
      }
      throw error;
    }
  };

  // Resolve this adapter's object metadata from the raw row the core passes
  // (the declared field values). The core no longer pre-resolves it, so
  // both the presigned and direct-upload paths run the same resolver here.
  const resolveMetadata = (info: StorageObjectInfo): Record<string, string> =>
    params.objectMetadata?.({
      key: info.key,
      filename: info.filename,
      size: info.size,
      contentType: info.contentType,
      isPublic: info.isPublic,
      ...(info.fields as InferFieldValues<TFields>),
    } as ObjectMetadataInput<TFields>) ?? {};

  const buildPutObjectInput = (
    info: StorageObjectInfo,
    metadata: Record<string, string>,
  ): AWS.PutObjectCommandInput => ({
    Bucket: bucket,
    Key: info.key,
    ContentType: info.contentType,
    ContentLength: info.size,
    Metadata: metadata,
    ACL: info.isPublic ? "public-read" : "private",
  });

  // S3 signs `x-amz-meta-*` into the presigned PUT, so the client must replay
  // those exact headers or the signature check fails. Surface them as
  // `requiredHeaders` for the upload plan. `Content-Type` is signed too but the
  // client always sends it, so it's intentionally left out here.
  const metadataHeaders = (metadata: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(metadata).map(([key, value]) => [`x-amz-meta-${key}`, value]),
    );

  return {
    generatePresignedUpload: async (info) => {
      const metadata = resolveMetadata(info);
      const command = new AWS.PutObjectCommand(buildPutObjectInput(info, metadata));
      const requiredHeaders = metadataHeaders(metadata);

      const uploadUrl = await getSignedUrl(s3Client, command, {
        expiresIn: info.expiresInSeconds,
        // Keep x-amz-meta-* as SIGNED HEADERS (not hoisted into the query string):
        // the client replays them via requiredHeaders, and hoisted+replayed would be
        // an unsigned-header signature mismatch. Also keeps metadata out of the URL.
        unhoistableHeaders: new Set(Object.keys(requiredHeaders)),
      });

      return {
        uploadUrl,
        requiredHeaders: Object.keys(requiredHeaders).length > 0 ? requiredHeaders : undefined,
      };
    },

    uploadFile: async (info) => {
      const metadata = resolveMetadata(info);
      const command = new AWS.PutObjectCommand({
        ...buildPutObjectInput(info, metadata),
        Body: info.content,
      });

      await s3Client.send(command);

      return {
        key: info.key,
      };
    },

    verifyUpload: async (params) => {
      try {
        const command = new AWS.HeadObjectCommand({
          Bucket: bucket,
          Key: params.key,
        });

        const response = await s3Client.send(command);

        const actualSize = response.ContentLength || 0;
        const actualContentType = response.ContentType || "";
        const actualEtag = response.ETag?.replace(/"/g, "") || "";
        const lastModified = response.LastModified;

        const errors: string[] = [];

        if (actualSize !== params.expectedSize) {
          errors.push(`Size mismatch: expected ${params.expectedSize}, got ${actualSize}`);
        }

        if (params.expectedContentType && actualContentType !== params.expectedContentType) {
          errors.push(
            `Content type mismatch: expected ${params.expectedContentType}, got ${actualContentType}`,
          );
        }

        if (params.clientEtag && actualEtag !== params.clientEtag) {
          errors.push(`ETag mismatch: expected ${params.clientEtag}, got ${actualEtag}`);
        }

        if (actualSize === 0) {
          errors.push("File is empty");
        }

        return {
          exists: true,
          isValid: errors.length === 0,
          error: errors[0],
          etag: actualEtag,
          actualSize,
          lastModified,
        };

        // oxlint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (error: any) {
        // Only a missing object is the client's fault (file never uploaded).
        // Everything else — throttling, credentials, S3 5xx, network — is a
        // server-side failure and must propagate as a retryable 500, not get
        // reported to the client as an invalid upload (400).
        if (
          error.name === "NotFound" ||
          error.name === "NoSuchKey" ||
          error.$metadata?.httpStatusCode === 404
        ) {
          return {
            exists: false,
            isValid: false,
            error: "File not found in S3",
          };
        }

        throw error;
      }
    },

    deleteFile: async (params) => {
      // DeleteObject is idempotent — only pay for a HeadObject probe when the
      // caller wants a hard error on a missing key.
      if (params.throwIfNotFound && !(await fileExists(params.key))) {
        throw new Error("File not found in S3");
      }

      const command = new AWS.DeleteObjectCommand({
        Bucket: bucket,
        Key: params.key,
      });

      await s3Client.send(command);
    },

    batchDeleteFiles: async (params) => {
      if (params.fileKeys.length === 0) {
        return;
      }

      const command = new AWS.DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: params.fileKeys.map((key) => ({ Key: key })),
        },
      });

      const res = await s3Client.send(command);

      if (res.Errors && res.Errors.length > 0) {
        const errorMessage = `Error when batch deleting files: ${res.Errors.map(
          (error) => `${error.Key} (${error.Code}: ${error.Message})`,
        ).join(", ")}`;

        if (params.throwIfError) {
          throw new Error(errorMessage);
        }

        console.error(errorMessage);
      }
    },
  };
};
