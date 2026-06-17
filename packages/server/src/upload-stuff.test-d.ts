import { expectTypeOf, it } from "vite-plus/test";

import type { DatabaseAdapter, StorageAdapter } from "@upload-stuff/core";

import { UploadStuff } from "./upload-stuff";

declare const storageAdapter: StorageAdapter;
declare const databaseAdapter: DatabaseAdapter<"avatar">;

it("types the objectMetadata resolver against the declared fields", () => {
  UploadStuff<"avatar">()({
    storageAdapter,
    databaseAdapter,
    filePublicUrlGenerator: ({ key }) => key,
    fields: {
      entityId: { type: "string", required: false },
      count: { type: "number", required: true },
    },
    objectMetadata: (file) => {
      // declared fields are typed from the central declaration
      expectTypeOf(file.entityId).toEqualTypeOf<string | undefined>();
      expectTypeOf(file.count).toEqualTypeOf<number>();
      // library columns come through too
      expectTypeOf(file.scope).toEqualTypeOf<string | undefined>();
      expectTypeOf(file.usageContext).toEqualTypeOf<"avatar">();
      return { entity: file.entityId ?? "", count: String(file.count) };
    },
  });
});
