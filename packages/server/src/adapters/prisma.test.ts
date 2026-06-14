import { describe, expect, it } from "vite-plus/test";

import { prismaAdapter } from "./prisma";

/* oxlint-disable @typescript-eslint/no-explicit-any */

/** Minimal in-memory fake of the Prisma `file` delegate. */
const fakePrisma = () => {
  const calls: string[] = [];
  let rows: Array<{ id: string; key: string }> = [
    { id: "f1", key: "k1" },
    { id: "f2", key: "k2" },
  ];
  return {
    calls,
    getRows: () => rows,
    client: {
      file: {
        createMany: async () => ({ count: 0 }),
        findMany: async (args: any) => {
          calls.push("findMany");
          return rows.filter((r) => args.where.id.in.includes(r.id));
        },
        update: async (args: any) => args,
        updateMany: async () => ({ count: 0 }),
        deleteMany: async (args: any) => {
          calls.push("deleteMany");
          rows = rows.filter((r) => !args.where.id.in.includes(r.id));
          return {};
        },
      },
    },
  };
};

describe("prismaAdapter.deleteFiles", () => {
  it("deletes from storage before deleting DB rows", async () => {
    const fake = fakePrisma();
    const adapter = prismaAdapter({ prisma: fake.client });
    const deletedKeys: string[][] = [];

    await adapter.deleteFiles({
      fileIds: ["f1", "f2"],
      deleteFromStorage: async (fileKeys) => {
        fake.calls.push("storage");
        deletedKeys.push(fileKeys);
      },
    });

    expect(deletedKeys).toEqual([["k1", "k2"]]);
    expect(fake.calls).toEqual(["findMany", "storage", "deleteMany"]);
    expect(fake.getRows()).toEqual([]);
  });

  it("keeps DB rows when the storage delete fails", async () => {
    const fake = fakePrisma();
    const adapter = prismaAdapter({ prisma: fake.client });

    await expect(
      adapter.deleteFiles({
        fileIds: ["f1"],
        deleteFromStorage: async () => {
          throw new Error("storage down");
        },
      }),
    ).rejects.toThrow("storage down");

    expect(fake.getRows()).toHaveLength(2);
  });
});
