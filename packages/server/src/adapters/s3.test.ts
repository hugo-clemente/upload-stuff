/* oxlint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

// Hoisted so vi.mock factories can safely close over the mocks.
const { sendMock, getSignedUrlMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  getSignedUrlMock: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();

  return {
    ...actual,
    S3Client: class {
      config: unknown;

      constructor(config: unknown) {
        this.config = config;
      }

      send(command: unknown) {
        return sendMock(command);
      }
    },
  };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: getSignedUrlMock,
}));

import * as AWS from "@aws-sdk/client-s3";

import { s3Adapter } from "./s3";

function routeSend(handlers: Record<string, (cmd: any) => unknown>) {
  sendMock.mockImplementation((command: any) => {
    const name = command.constructor.name;
    const handler = handlers[name];
    if (!handler) throw new Error(`unexpected S3 command in test: ${name}`);
    return handler(command);
  });
}

const s3Error = (name: string, httpStatusCode: number) =>
  new AWS.S3ServiceException({
    name,
    message: name,
    $fault: httpStatusCode >= 500 ? "server" : "client",
    $metadata: { httpStatusCode },
  });

const makeAdapter = (opts?: {
  objectMetadata?: (file: any) => Record<string, string>;
}) =>
  s3Adapter({
    config: { region: "us-east-1" },
    bucket: "test-bucket",
    objectMetadata: opts?.objectMetadata,
  })({} as any);

const sentCommandNames = () =>
  sendMock.mock.calls.map((c) => (c[0] as any).constructor.name);

const baseInfo = {
  key: "u/1/file.png",
  filename: "file.png",
  contentType: "image/png",
  size: 1234,
  isPublic: true,
  fields: { userId: "u1" },
};

beforeEach(() => {
  sendMock.mockReset();
  getSignedUrlMock.mockReset();
  getSignedUrlMock.mockResolvedValue("https://signed.test/upload");
});

describe("s3Adapter.generatePresignedUpload", () => {
  it("builds a public PutObjectCommand, metadata headers, and signer options", async () => {
    const adapter = makeAdapter({
      objectMetadata: (file) => ({
        filename: file.filename,
        owner: String(file.userId),
      }),
    });

    const res = await adapter.generatePresignedUpload({
      ...baseInfo,
      expiresInSeconds: 3600,
    });

    expect(res.uploadUrl).toBe("https://signed.test/upload");
    expect(res.requiredHeaders).toEqual({
      "x-amz-meta-filename": "file.png",
      "x-amz-meta-owner": "u1",
    });

    const [client, command, options] = getSignedUrlMock.mock.calls[0] as [
      unknown,
      any,
      any,
    ];

    // The adapter must hand the user's config to the client it constructs,
    // not silently drop region/credentials via new S3Client({}).
    expect((client as any).config).toEqual({ region: "us-east-1" });
    expect(command).toBeInstanceOf(AWS.PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: "test-bucket",
      Key: "u/1/file.png",
      ContentType: "image/png",
      ContentLength: 1234,
      Metadata: { filename: "file.png", owner: "u1" },
      ACL: "public-read",
    });
    expect(options.expiresIn).toBe(3600);
    expect(options.unhoistableHeaders).toEqual(
      new Set(["x-amz-meta-filename", "x-amz-meta-owner"]),
    );
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("omits requiredHeaders and uses private ACL when there is no metadata", async () => {
    const adapter = makeAdapter();

    const res = await adapter.generatePresignedUpload({
      ...baseInfo,
      isPublic: false,
      expiresInSeconds: 60,
    });

    expect(res.requiredHeaders).toBeUndefined();

    const [, command, options] = getSignedUrlMock.mock.calls[0] as [
      unknown,
      any,
      any,
    ];

    expect(command.input.Metadata).toEqual({});
    expect(command.input.ACL).toBe("private");
    expect(options.unhoistableHeaders).toEqual(new Set());
  });
});

describe("s3Adapter.uploadFile", () => {
  it("sends a PutObjectCommand with Body, resolved metadata and ACL, then returns the key", async () => {
    routeSend({ PutObjectCommand: () => ({}) });
    const adapter = makeAdapter({
      objectMetadata: (file) => ({ owner: String(file.userId) }),
    });
    const content = new Uint8Array([1, 2, 3]);

    const res = await adapter.uploadFile({
      ...baseInfo,
      isPublic: false,
      content,
    });

    expect(res).toEqual({ key: "u/1/file.png" });

    const sent = sendMock.mock.calls[0]![0] as any;
    expect(sent).toBeInstanceOf(AWS.PutObjectCommand);
    expect(sent.input).toMatchObject({
      Bucket: "test-bucket",
      Key: "u/1/file.png",
      ContentType: "image/png",
      ContentLength: 1234,
      Metadata: { owner: "u1" },
      ACL: "private",
      Body: content,
    });
  });

  it("propagates a send failure instead of reporting success", async () => {
    routeSend({
      PutObjectCommand: () => {
        throw s3Error("InternalError", 500);
      },
    });
    const adapter = makeAdapter();

    await expect(
      adapter.uploadFile({ ...baseInfo, content: "hello" }),
    ).rejects.toThrow();
  });
});

describe("s3Adapter.verifyUpload", () => {
  const headOk = (over: Record<string, unknown> = {}) => ({
    ContentLength: 1234,
    ContentType: "image/png",
    ETag: '"abc123"',
    LastModified: new Date(0),
    ...over,
  });

  it("passes on matching size and content type, returning stripped etag and metadata", async () => {
    routeSend({ HeadObjectCommand: () => headOk() });
    const adapter = makeAdapter();

    const r = await adapter.verifyUpload({
      key: "k",
      expectedSize: 1234,
      expectedContentType: "image/png",
    });

    expect(r).toMatchObject({
      exists: true,
      isValid: true,
      etag: "abc123",
      actualSize: 1234,
    });
    expect(r.lastModified).toEqual(new Date(0));

    // Completion at router/core.ts trusts this result for `key`, so verify we
    // actually HEAD the right object.
    const head = sendMock.mock.calls[0]![0] as any;
    expect(head).toBeInstanceOf(AWS.HeadObjectCommand);
    expect(head.input).toMatchObject({ Bucket: "test-bucket", Key: "k" });
  });

  it("strips quotes from S3's ETag before comparing clientEtag", async () => {
    routeSend({ HeadObjectCommand: () => headOk({ ETag: '"deadbeef"' }) });
    const adapter = makeAdapter();

    const r = await adapter.verifyUpload({
      key: "k",
      expectedSize: 1234,
      expectedContentType: "image/png",
      clientEtag: "deadbeef",
    });

    expect(r.isValid).toBe(true);
  });

  it("reports a size mismatch first, before content-type and etag", async () => {
    routeSend({
      HeadObjectCommand: () =>
        headOk({ ContentLength: 999, ContentType: "text/plain" }),
    });
    const adapter = makeAdapter();

    const r = await adapter.verifyUpload({
      key: "k",
      expectedSize: 1234,
      expectedContentType: "image/png",
      clientEtag: "nope",
    });

    expect(r.isValid).toBe(false);
    expect(r.error).toBe("Size mismatch: expected 1234, got 999");
  });

  it("reports a content-type mismatch when size matches", async () => {
    routeSend({ HeadObjectCommand: () => headOk({ ContentType: "text/plain" }) });
    const adapter = makeAdapter();

    const r = await adapter.verifyUpload({
      key: "k",
      expectedSize: 1234,
      expectedContentType: "image/png",
    });

    expect(r.isValid).toBe(false);
    expect(r.error).toBe("Content type mismatch: expected image/png, got text/plain");
  });

  it("reports an etag mismatch when size and content type match", async () => {
    routeSend({ HeadObjectCommand: () => headOk() });
    const adapter = makeAdapter();

    const r = await adapter.verifyUpload({
      key: "k",
      expectedSize: 1234,
      expectedContentType: "image/png",
      clientEtag: "different",
    });

    expect(r.isValid).toBe(false);
    expect(r.error).toBe("ETag mismatch: expected different, got abc123");
  });

  it("reports an empty file", async () => {
    routeSend({ HeadObjectCommand: () => headOk({ ContentLength: 0 }) });
    const adapter = makeAdapter();

    const r = await adapter.verifyUpload({
      key: "k",
      expectedSize: 0,
      expectedContentType: "image/png",
    });

    expect(r.isValid).toBe(false);
    expect(r.error).toBe("File is empty");
  });

  it("catches a size mismatch even when the expected size is 0", async () => {
    routeSend({
      HeadObjectCommand: () =>
        headOk({ ContentLength: 500, ContentType: "text/plain" }),
    });
    const adapter = makeAdapter();

    const r = await adapter.verifyUpload({
      key: "k",
      expectedSize: 0,
      expectedContentType: "text/plain",
    });

    expect(r.isValid).toBe(false);
    expect(r.error).toBe("Size mismatch: expected 0, got 500");
  });

  it.each(["NotFound", "NoSuchKey"])(
    "treats a real S3 %s error as a missing object",
    async (name) => {
      routeSend({
        HeadObjectCommand: () => {
          throw s3Error(name, 404);
        },
      });
      const adapter = makeAdapter();

      const r = await adapter.verifyUpload({
        key: "k",
        expectedSize: 1,
        expectedContentType: "image/png",
      });

      expect(r).toEqual({
        exists: false,
        isValid: false,
        error: "File not found in S3",
      });
    },
  );

  it("treats an httpStatusCode 404 as a missing object", async () => {
    routeSend({
      HeadObjectCommand: () => {
        throw { name: "Whatever", $metadata: { httpStatusCode: 404 } };
      },
    });
    const adapter = makeAdapter();

    const r = await adapter.verifyUpload({
      key: "k",
      expectedSize: 1,
      expectedContentType: "image/png",
    });

    expect(r.exists).toBe(false);
    expect(r.isValid).toBe(false);
  });

  it("rethrows non-404 errors so they surface as retryable server failures", async () => {
    routeSend({
      HeadObjectCommand: () => {
        throw s3Error("ThrottlingException", 503);
      },
    });
    const adapter = makeAdapter();

    await expect(
      adapter.verifyUpload({
        key: "k",
        expectedSize: 1,
        expectedContentType: "image/png",
      }),
    ).rejects.toThrow();
  });
});

describe("s3Adapter.deleteFile", () => {
  it("probes with HeadObject then deletes when throwIfNotFound is true and the key exists", async () => {
    routeSend({
      HeadObjectCommand: () => ({}),
      DeleteObjectCommand: () => ({}),
    });
    const adapter = makeAdapter();

    await adapter.deleteFile({ key: "k", throwIfNotFound: true });

    expect(sentCommandNames()).toEqual(["HeadObjectCommand", "DeleteObjectCommand"]);

    const del = sendMock.mock.calls[1]![0] as any;
    expect(del.input).toMatchObject({ Bucket: "test-bucket", Key: "k" });
  });

  it("throws and skips delete when throwIfNotFound is true and S3 returns NotFound", async () => {
    routeSend({
      HeadObjectCommand: () => {
        throw s3Error("NotFound", 404);
      },
    });
    const adapter = makeAdapter();

    await expect(
      adapter.deleteFile({ key: "k", throwIfNotFound: true }),
    ).rejects.toThrow("File not found in S3");
    expect(sentCommandNames()).toEqual(["HeadObjectCommand"]);
  });

  it("skips the HeadObject probe when throwIfNotFound is omitted", async () => {
    routeSend({ DeleteObjectCommand: () => ({}) });
    const adapter = makeAdapter();

    await adapter.deleteFile({ key: "k" });

    expect(sentCommandNames()).toEqual(["DeleteObjectCommand"]);
  });

  it("propagates a non-404 HeadObject failure and does not delete", async () => {
    routeSend({
      HeadObjectCommand: () => {
        throw s3Error("AccessDenied", 403);
      },
    });
    const adapter = makeAdapter();

    await expect(
      adapter.deleteFile({ key: "k", throwIfNotFound: true }),
    ).rejects.toThrow();
    expect(sentCommandNames()).toEqual(["HeadObjectCommand"]);
  });
});

describe("s3Adapter.batchDeleteFiles", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns without calling S3 when fileKeys is empty", async () => {
    const adapter = makeAdapter();

    await adapter.batchDeleteFiles({ fileKeys: [] });

    expect(sendMock).not.toHaveBeenCalled();
  });

  it("sends one DeleteObjectsCommand with every key mapped to { Key }", async () => {
    routeSend({ DeleteObjectsCommand: () => ({}) });
    const adapter = makeAdapter();

    await adapter.batchDeleteFiles({ fileKeys: ["a", "b"] });

    const cmd = sendMock.mock.calls[0]![0] as any;
    expect(cmd).toBeInstanceOf(AWS.DeleteObjectsCommand);
    expect(cmd.input.Bucket).toBe("test-bucket");
    expect(cmd.input.Delete.Objects).toEqual([{ Key: "a" }, { Key: "b" }]);
  });

  it("throws an aggregated message when S3 reports Errors and throwIfError is true", async () => {
    routeSend({
      DeleteObjectsCommand: () => ({
        Errors: [{ Key: "a", Code: "AccessDenied", Message: "nope" }],
      }),
    });
    const adapter = makeAdapter();

    await expect(
      adapter.batchDeleteFiles({ fileKeys: ["a"], throwIfError: true }),
    ).rejects.toThrow("a (AccessDenied: nope)");
  });

  it("logs and resolves when S3 reports Errors and throwIfError is falsy", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    routeSend({
      DeleteObjectsCommand: () => ({
        Errors: [{ Key: "a", Code: "AccessDenied", Message: "nope" }],
      }),
    });
    const adapter = makeAdapter();

    await adapter.batchDeleteFiles({ fileKeys: ["a"] });

    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy.mock.calls[0]![0]).toContain("a (AccessDenied: nope)");
  });
});
