import type { DatabaseAdapter, DatabaseFile, FieldsDeclaration } from "@upload-stuff/core";

/**
 * Minimal structural shape of the Prisma `File` delegate this adapter uses.
 * Declared locally so the package builds without a generated `@prisma/client`.
 * A consumer's real generated `PrismaClient` is structurally assignable to this.
 *
 * Only methods available on every Prisma relational connector are required —
 * `createMany`/`updateMany` (not the `*AndReturn` variants, which are
 * PostgreSQL/SQLite/CockroachDB-only) — so the adapter works with MySQL and
 * SQL Server too.
 */
/* oxlint-disable @typescript-eslint/no-explicit-any */
type PrismaClientLike = {
  file: {
    createMany: (args: any) => Promise<{ count: number }>;
    findMany: (args: any) => Promise<any[]>;
    update: (args: any) => Promise<any>;
    updateMany: (args: any) => Promise<{ count: number }>;
    deleteMany: (args: any) => Promise<any>;
  };
};
/* oxlint-enable @typescript-eslint/no-explicit-any */

export const prismaAdapter = <
  TFileUsageContext extends string = string,
  TFields extends FieldsDeclaration = Record<never, never>,
>({
  prisma,
}: {
  prisma: PrismaClientLike;
}): DatabaseAdapter<TFileUsageContext, TFields> => {
  return {
    createFiles: async ({ files }) => {
      await prisma.file.createMany({
        data: files.map((file) => ({
          ...file,
          // oxlint-disable-next-line @typescript-eslint/no-explicit-any
          uploadSessionData: file.uploadSessionData as any,
        })),
      });
    },

    findFilesByBatchIdAndScope: async (params) => {
      const files = await prisma.file.findMany({
        where: {
          batchId: params.batchId,
          // `?? null` matters: Prisma drops a `field: undefined` clause
          // entirely (matches all rows), whereas `field: null` matches
          // IS NULL. Anonymous uploads must only match anonymous batches.
          scope: params.scope ?? null,
        },
      });

      return files as DatabaseFile<TFileUsageContext, TFields>[];
    },

    findFilesToCleanUp: async (params) => {
      return await prisma.file.findMany({
        where: {
          createdAt: {
            lte: params.createdAtThreshold,
          },
          stored: false,
        },
        select: {
          id: true,
          key: true,
        },
      });
    },

    updateFilesToStored: async (params) => {
      // `stored: false` in the where-clause makes this an atomic guard: a
      // repeated or concurrent completion of the same batch updates 0 rows.
      const res = await prisma.file.updateMany({
        where: {
          batchId: params.batchId,
          // See findFilesByBatchIdAndScope — `?? null` keeps the scope filter
          // from silently vanishing for anonymous uploads.
          scope: params.scope ?? null,
          stored: false,
        },
        data: {
          storedAt: params.storedAt,
          stored: true,
        },
      });

      return { updatedCount: res.count };
    },

    updateFile: async ({ file }) => {
      const updatedFile = await prisma.file.update({
        where: {
          id: file.id,
        },
        data: {
          ...file,
          // oxlint-disable-next-line @typescript-eslint/no-explicit-any
          uploadSessionData: file.uploadSessionData as any,
        },
      });

      return updatedFile as DatabaseFile<TFileUsageContext, TFields>;
    },

    deleteFiles: async (params) => {
      const files = await prisma.file.findMany({
        where: {
          id: { in: params.fileIds },
        },
        select: { key: true },
      });

      // Storage first: a failed storage delete throws and keeps the DB rows,
      // so a retry can find the keys again (re-deleting already-removed keys
      // is idempotent). Deleting the rows first would commit while storage
      // objects survive — orphans nothing can ever find or clean up.
      await params.deleteFromStorage(files.map((file) => file.key));

      await prisma.file.deleteMany({
        where: {
          id: { in: params.fileIds },
        },
      });
    },
  };
};
