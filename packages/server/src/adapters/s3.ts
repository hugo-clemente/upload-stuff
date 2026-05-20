import * as AWS from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { StorageAdapter } from "@upload-stuff/core";

export const s3Adapter = (params: {
  config: AWS.S3ClientConfig;
  bucket: string;
}): StorageAdapter => {
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
      if (
        error instanceof AWS.S3ServiceException &&
        error.name === "NoSuchKey"
      ) {
        return false;
      }
      throw error;
    }
  };

  return {
    generatePresignedUpload: async (params) => {
      const command = new AWS.PutObjectCommand({
        Bucket: bucket,
        Key: params.key,
        ContentType: params.contentType,
        ContentLength: params.size,
        // Add metadata
        Metadata: {
          "uploaded-by": params.userId || "",
          "usage-context": params.usageContext,
          "entity-id": params.entityId || "",
        },
        // Set ACL based on public flag
        ACL: params.isPublic ? "public-read" : "private",
      });

      const uploadUrl = await getSignedUrl(s3Client, command, {
        expiresIn: 3600, // 1 hour
      });

      return {
        uploadUrl,
      };
    },

    uploadFile: async (params) => {
      const command = new AWS.PutObjectCommand({
        Bucket: bucket,
        Key: params.key,
        Body: params.content,
        ContentType: params.contentType,
        ContentLength: params.size,
        // Add metadata
        Metadata: {
          "uploaded-by": params.userId || "",
          "usage-context": params.usageContext,
          "entity-id": params.entityId || "",
        },
        // Set ACL based on public flag
        ACL: params.isPublic ? "public-read" : "private",
      });

      await s3Client.send(command);

      return {
        key: params.key,
      };
    },

    verifyUpload: async (params) => {
      try {
        // Use HeadObject to get file metadata without downloading the file
        const command = new AWS.HeadObjectCommand({
          Bucket: bucket,
          Key: params.key,
        });

        const response = await s3Client.send(command);

        // File exists, now verify its properties
        const actualSize = response.ContentLength || 0;
        const actualContentType = response.ContentType || "";
        const actualEtag = response.ETag?.replace(/"/g, "") || "";
        const lastModified = response.LastModified;

        // Perform various validation checks
        const validations: Array<{ isValid: boolean; error: string }> = [];

        // Check file size
        if (params.expectedSize && actualSize !== params.expectedSize) {
          validations.push({
            isValid: false,
            error: `Size mismatch: expected ${params.expectedSize}, got ${actualSize}`,
          });
        }

        // Check content type
        if (
          params.expectedContentType &&
          actualContentType !== params.expectedContentType
        ) {
          validations.push({
            isValid: false,
            error: `Content type mismatch: expected ${params.expectedContentType}, got ${actualContentType}`,
          });
        }

        // Check ETag (if provided by client)
        if (params.clientEtag && actualEtag !== params.clientEtag) {
          validations.push({
            isValid: false,
            error: `ETag mismatch: expected ${params.clientEtag}, got ${actualEtag}`,
          });
        }

        // Check if file is empty
        if (actualSize === 0) {
          validations.push({
            isValid: false,
            error: "File is empty",
          });
        }

        const failedValidation = validations.find((v) => !v.isValid);

        return {
          exists: true,
          isValid: !failedValidation,
          error: failedValidation?.error,
          etag: actualEtag,
          actualSize,
          lastModified,
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (error: any) {
        // If it's a NoSuchKey error, the file doesn't exist
        if (
          error.name === "NoSuchKey" ||
          error.$metadata?.httpStatusCode === 404
        ) {
          return {
            exists: false,
            isValid: false,
            error: "File not found in S3" as const,
          };
        }

        // For other errors, rethrow or handle as needed
        return {
          exists: false,
          isValid: false,
          error: `Verification failed: ${error.message}` as const,
        };
      }
    },

    deleteFile: async (params) => {
      const exists = await fileExists(params.key);

      if (!exists && params.throwIfNotFound) {
        throw new Error("File not found in S3");
      }

      if (!exists) {
        return;
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
        // Maybe add monitoring here
        const errorMessage = `Error when batch deleting files: ${res.Errors.map((error) => error.Key).join(", ")}`;

        if (params.throwIfError) {
          throw new Error(errorMessage);
        }

        console.error("Error when deleting files");
      }
    },
  };
};
