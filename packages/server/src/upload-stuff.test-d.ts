import { expectTypeOf, it } from "vite-plus/test";

import type { DatabaseAdapterFactory, StorageAdapterFactory } from "@upload-stuff/core";

import { s3Adapter } from "./adapters/s3";
import { UploadStuff } from "./upload-stuff";

// Adapter factories. `TFields` is inferred from the central `fields` declaration
// (the adapter positions are `NoInfer`), so `any` keeps these fixtures focused on
// the typing under test.
// oxlint-disable-next-line @typescript-eslint/no-explicit-any
declare const databaseAdapter: DatabaseAdapterFactory<any>;
// oxlint-disable-next-line @typescript-eslint/no-explicit-any
declare const storageAdapter: StorageAdapterFactory<any>;

it("types the storage adapter's objectMetadata resolver against the declared fields", () => {
  UploadStuff({
    // The s3 adapter's `objectMetadata` is typed purely by inference: `TFields` is
    // resolved from `fields` below and flows into the adapter factory's contextual
    // type, so `file` is precise with no annotation.
    storageAdapter: s3Adapter({
      config: {},
      bucket: "bucket",
      objectMetadata: (file) => {
        // declared fields are typed from the central declaration
        expectTypeOf(file.entityId).toEqualTypeOf<string | undefined>();
        expectTypeOf(file.count).toEqualTypeOf<number>();
        // library columns come through too
        expectTypeOf(file.key).toEqualTypeOf<string>();
        type DeletedKey = `usage${"Context"}`;
        type DeletedMetadataKey = Extract<keyof typeof file, DeletedKey>;
        expectTypeOf<DeletedMetadataKey>().toEqualTypeOf<never>();
        return { entity: file.entityId ?? "", count: String(file.count) };
      },
    }),
    databaseAdapter,
    filePublicUrlGenerator: ({ key }) => key,
    fields: {
      entityId: { type: "string", required: false },
      count: { type: "number", required: true },
    },
  });
});

it("rejects a custom field that reuses a reserved column name (#1)", () => {
  UploadStuff({
    storageAdapter,
    databaseAdapter,
    filePublicUrlGenerator: ({ key }) => key,
    fields: {
      // @ts-expect-error `stored` is a reserved library column name
      stored: { type: "string", required: false },
    },
  });
});
