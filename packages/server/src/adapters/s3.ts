import * as AWS from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { StorageAdapter, StorageObjectInfo } from "@upload-stuff/core";

export const s3Adapter = (params: {
  config: AWS.S3ClientConfig;
  bucket: string;
  /**
   * Maps a stored object to its S3 object metadata (`x-amz-meta-*`). Defaults to
   * none. Note: object metadata is returned on every GetObject, so do not place
   * a `scope` that encodes a user/principal id here on public buckets without
   * intending to expose it.
   */
  objectMetadata?: (info: StorageObjectInfo) => Record<string, string>;
}): StorageAdapter => {
  const s3Client = new AWS.S3Client(params.config);
  const bucket = params.bucket;
  const objectMetadata = params.objectMetadata ?? (() => ({}));

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

  const buildPutObjectInput = (info: StorageObjectInfo): AWS.PutObjectCommandInput => ({
    Bucket: bucket,
    Key: info.key,
    ContentType: info.contentType,
    ContentLength: info.size,
    Metadata: objectMetadata(info),
    ACL: info.isPublic ? "public-read" : "private",
  });

  return {
    generatePresignedUpload: async (params) => {
      const command = new AWS.PutObjectCommand(buildPutObjectInput(params));

      const uploadUrl = await getSignedUrl(s3Client, command, {
        expiresIn: 3600, // 1 hour
      });

      return {
        uploadUrl,
      };
    },

    uploadFile: async (params) => {
      const command = new AWS.PutObjectCommand({
        ...buildPutObjectInput(params),
        Body: params.content,
      });

      await s3Client.send(command);

      return {
        key: params.key,
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

        if (params.expectedSize && actualSize !== params.expectedSize) {
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
