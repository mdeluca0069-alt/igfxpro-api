/*
  Warnings:

  - The values [MARGIN_CALL,STOPPED,CLOSED] on the enum `AccountStatus` will be removed. If these variants are still used in the database, this will fail.
  - The values [COMPLETED,FAILED] on the enum `DepositStatus` will be removed. If these variants are still used in the database, this will fail.
  - The values [SUPER_ADMIN] on the enum `RoleName` will be removed. If these variants are still used in the database, this will fail.
  - The values [PENDING,CLOSED] on the enum `UserStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `accountId` on the `Deposit` table. All the data in the column will be lost.
  - You are about to drop the column `transactionId` on the `Deposit` table. All the data in the column will be lost.
  - You are about to drop the column `lastPrice` on the `Market` table. All the data in the column will be lost.
  - You are about to drop the column `leverage` on the `Market` table. All the data in the column will be lost.
  - You are about to drop the column `tradingHours` on the `Market` table. All the data in the column will be lost.
  - You are about to drop the column `roleId` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `currency` on the `Wallet` table. All the data in the column will be lost.
  - You are about to drop the column `margin` on the `Wallet` table. All the data in the column will be lost.
  - You are about to drop the `Permission` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PriceTick` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Role` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `RolePermission` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Setting` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `walletId` to the `Deposit` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `method` on the `Deposit` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Added the required column `price` to the `Trade` table without a default value. This is not possible if the table is not empty.
  - Added the required column `symbol` to the `Trade` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'TRADE_PNL', 'COMMISSION', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "KYCStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RiskClass" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "PositionMode" AS ENUM ('HEDGE', 'ONE_WAY');

-- CreateEnum
CREATE TYPE "FundType" AS ENUM ('CLIENT', 'BROKER', 'AFFILIATE');

-- CreateEnum
CREATE TYPE "RiskEventType" AS ENUM ('LIQUIDATION_WARNING', 'LIQUIDATION_EXECUTED', 'MARGIN_CALL', 'TRADE_LIMIT_EXCEEDED');

-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('STANDARD', 'AFFILIATE', 'REBATE');

-- AlterEnum
BEGIN;
CREATE TYPE "AccountStatus_new" AS ENUM ('INACTIVE', 'ACTIVE', 'BLOCKED');
ALTER TABLE "Account" ALTER COLUMN "status" TYPE "AccountStatus_new" USING ("status"::text::"AccountStatus_new");
ALTER TYPE "AccountStatus" RENAME TO "AccountStatus_old";
ALTER TYPE "AccountStatus_new" RENAME TO "AccountStatus";
DROP TYPE "AccountStatus_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "DepositStatus_new" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
ALTER TABLE "Deposit" ALTER COLUMN "status" TYPE "DepositStatus_new" USING ("status"::text::"DepositStatus_new");
ALTER TYPE "DepositStatus" RENAME TO "DepositStatus_old";
ALTER TYPE "DepositStatus_new" RENAME TO "DepositStatus";
DROP TYPE "DepositStatus_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "RoleName_new" AS ENUM ('CLIENT', 'ADMIN', 'RISK', 'SUPPORT', 'BROKER');
ALTER TABLE "User" ALTER COLUMN "role" TYPE "RoleName_new" USING ("role"::text::"RoleName_new");
ALTER TYPE "RoleName" RENAME TO "RoleName_old";
ALTER TYPE "RoleName_new" RENAME TO "RoleName";
DROP TYPE "RoleName_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "UserStatus_new" AS ENUM ('UNVERIFIED', 'MIFID_PENDING', 'KYC_PENDING', 'ACTIVE', 'SUSPENDED');
ALTER TABLE "User" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "status" TYPE "UserStatus_new" USING ("status"::text::"UserStatus_new");
ALTER TYPE "UserStatus" RENAME TO "UserStatus_old";
ALTER TYPE "UserStatus_new" RENAME TO "UserStatus";
DROP TYPE "UserStatus_old";
ALTER TABLE "User" ALTER COLUMN "status" SET DEFAULT 'UNVERIFIED';
COMMIT;

-- DropForeignKey
ALTER TABLE "Deposit" DROP CONSTRAINT "Deposit_accountId_fkey";

-- DropForeignKey
ALTER TABLE "PriceTick" DROP CONSTRAINT "PriceTick_marketId_fkey";

-- DropForeignKey
ALTER TABLE "RolePermission" DROP CONSTRAINT "RolePermission_permissionId_fkey";

-- DropForeignKey
ALTER TABLE "RolePermission" DROP CONSTRAINT "RolePermission_roleId_fkey";

-- DropForeignKey
ALTER TABLE "Trade" DROP CONSTRAINT "Trade_marketId_fkey";

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_roleId_fkey";

-- AlterTable
ALTER TABLE "Account" ALTER COLUMN "status" SET DEFAULT 'INACTIVE';

-- AlterTable
ALTER TABLE "Deposit" DROP COLUMN "accountId",
DROP COLUMN "transactionId",
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "walletId" TEXT NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'PENDING',
DROP COLUMN "method",
ADD COLUMN     "method" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Market" DROP COLUMN "lastPrice",
DROP COLUMN "leverage",
DROP COLUMN "tradingHours",
ADD COLUMN     "maxVolume" DOUBLE PRECISION,
ADD COLUMN     "minVolume" DOUBLE PRECISION,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "spread" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "swapLong" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "swapShort" DOUBLE PRECISION NOT NULL DEFAULT 0,
ALTER COLUMN "type" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Trade" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "pnl" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "price" DECIMAL(65,30) NOT NULL,
ADD COLUMN     "symbol" TEXT NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'OPEN',
ALTER COLUMN "entryPrice" DROP NOT NULL,
ALTER COLUMN "marketId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "roleId",
ADD COLUMN     "role" "RoleName" NOT NULL DEFAULT 'CLIENT',
ALTER COLUMN "status" SET DEFAULT 'UNVERIFIED',
ALTER COLUMN "name" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Wallet" DROP COLUMN "currency",
DROP COLUMN "margin",
ADD COLUMN     "available" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "marginUsed" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- DropTable
DROP TABLE "Permission";

-- DropTable
DROP TABLE "PriceTick";

-- DropTable
DROP TABLE "Role";

-- DropTable
DROP TABLE "RolePermission";

-- DropTable
DROP TABLE "Setting";

-- DropEnum
DROP TYPE "DepositMethod";

-- DropEnum
DROP TYPE "MarketType";

-- DropEnum
DROP TYPE "PermissionName";

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" "LedgerType" NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Withdrawal" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'PENDING',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Withdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MiFIDProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "experience" TEXT NOT NULL,
    "objectives" TEXT NOT NULL,
    "riskClass" "RiskClass" NOT NULL,
    "eligible" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MiFIDProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserKYC" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "status" "KYCStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "UserKYC_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyStats" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "activeClients" INTEGER NOT NULL DEFAULT 0,
    "totalAccounts" INTEGER NOT NULL DEFAULT 0,
    "totalTrades" INTEGER NOT NULL DEFAULT 0,
    "totalVolume" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalCommission" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "activeAccounts" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionPlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "basePercentage" DECIMAL(65,30) NOT NULL,
    "volumeBonus" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntroducingBroker" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "commissionPlan" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntroducingBroker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceSnapshot" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "price" DECIMAL(65,30) NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskEvent" (
    "id" TEXT NOT NULL,
    "type" "RiskEventType" NOT NULL,
    "accountId" TEXT,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "RiskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalContent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalContent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MiFIDProfile_userId_key" ON "MiFIDProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserKYC_userId_key" ON "UserKYC"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "IntroducingBroker_name_key" ON "IntroducingBroker"("name");

-- CreateIndex
CREATE UNIQUE INDEX "IntroducingBroker_email_key" ON "IntroducingBroker"("email");

-- CreateIndex
CREATE INDEX "PriceSnapshot_symbol_idx" ON "PriceSnapshot"("symbol");

-- CreateIndex
CREATE INDEX "PriceSnapshot_timestamp_idx" ON "PriceSnapshot"("timestamp");

-- CreateIndex
CREATE INDEX "RiskEvent_accountId_idx" ON "RiskEvent"("accountId");

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MiFIDProfile" ADD CONSTRAINT "MiFIDProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserKYC" ADD CONSTRAINT "UserKYC_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
