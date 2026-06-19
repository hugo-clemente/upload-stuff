import { expectTypeOf, it } from "vite-plus/test";

import type { DatabaseAdapter, StorageAdapter } from "@upload-stuff/core";

import { UploadStuff } from "./upload-stuff";

declare const storageAdapter: StorageAdapter;
// `TFields` is inferred from the `fields` declaration (the adapter position is
// `NoInfer`); the adapter just has to be assignable, so `any` keeps this fixture
// focused on the `objectMetadata` typing under test.
// oxlint-disable-next-line @typescript-eslint/no-explicit-any
declare const databaseAdapter: DatabaseAdapter<"avatar", any>;

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

it("rejects a custom field that reuses a reserved column name (#1)", () => {
  UploadStuff<"avatar">()({
    storageAdapter,
    databaseAdapter,
    filePublicUrlGenerator: ({ key }) => key,
    fields: {
      // @ts-expect-error `scope` is a reserved library column name
      scope: { type: "string", required: false },
    },
  });
});
