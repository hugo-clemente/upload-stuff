import type { DatabaseAdapter, DatabaseFile } from "@upload-stuff/core";

/**
 * Minimal structural shape of the Prisma `File` delegate this adapter uses.
 * Declared locally so the package builds without a generated `@prisma/client`.
 * A consumer's real generated `PrismaClient` is structurally assignable to this.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
type PrismaClientLike = {
  file: {
    create: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<any[]>;
    update: (args: any) => Promise<any>;
    updateManyAndReturn: (args: any) => Promise<any[]>;
    deleteMany: (args: any) => Promise<any>;
  };
  $transaction: (fn: (tx: PrismaClientLike) => Promise<any>) => Promise<any>;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export const prismaAdapter = <TFileUsageContext extends string = string>({
  prisma,
}: {
  prisma: PrismaClientLike;
}): DatabaseAdapter<TFileUsageContext> => {
  return {
    createFile: async ({ file }) => {
      const createdFile = await prisma.file.create({
        data: {
          ...file,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          uploadSessionData: file.uploadSessionData as any,
        },
      });

      return createdFile as DatabaseFile<TFileUsageContext>;
    },

    findFilesByBatchIdAndUploadedBy: async (params) => {
      const files = await prisma.file.findMany({
        where: {
          batchId: params.batchId,
          uploadedBy: params.uploadedBy,
        },
      });

      return files as DatabaseFile<TFileUsageContext>[];
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
      const updatedFiles = await prisma.file.updateManyAndReturn({
        where: {
          batchId: params.batchId,
          uploadedBy: params.uploadedBy,
        },
        data: {
          storedAt: params.storedAt,
          stored: true,
        },
      });

      return updatedFiles as DatabaseFile<TFileUsageContext>[];
    },

    updateFile: async ({ file }) => {
      const updatedFile = await prisma.file.update({
        where: {
          id: file.id,
        },
        data: {
          ...file,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          uploadSessionData: file.uploadSessionData as any,
        },
      });

      return updatedFile as DatabaseFile<TFileUsageContext>;
    },

    deleteFiles: async (params) => {
      const files = await prisma.file.findMany({
        where: {
          id: { in: params.fileIds },
        },
      });

      await prisma.$transaction(async (tx) => {
        await tx.file.deleteMany({
          where: {
            id: { in: params.fileIds },
          },
        });

        await params.deleteFromStorage(files.map((file) => file.key));
      });
    },
  };
};
