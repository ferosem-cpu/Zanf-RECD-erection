-- CreateEnum
CREATE TYPE "BackupMethod" AS ENUM ('FULL', 'INCREMENTAL');

-- CreateTable
CREATE TABLE "BackupSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "scheduleEnabled" BOOLEAN NOT NULL DEFAULT false,
    "scheduleDayOfWeek" INTEGER NOT NULL DEFAULT 0,
    "scheduleHour" INTEGER NOT NULL DEFAULT 1,
    "scheduleMinute" INTEGER NOT NULL DEFAULT 0,
    "method" "BackupMethod" NOT NULL DEFAULT 'FULL',
    "lastRunAt" TIMESTAMP(3),
    "lastRunStatus" TEXT,
    "lastFullBackupAt" TIMESTAMP(3),
    "driveBackupsFolderId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackupSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupLog" (
    "id" TEXT NOT NULL,
    "method" "BackupMethod" NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "tableCount" INTEGER,
    "rowCount" INTEGER,
    "sizeBytes" INTEGER,
    "driveFileId" TEXT,
    "driveFileLink" TEXT,
    "errorMessage" TEXT,
    "triggeredById" TEXT,

    CONSTRAINT "BackupLog_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "BackupLog" ADD CONSTRAINT "BackupLog_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
