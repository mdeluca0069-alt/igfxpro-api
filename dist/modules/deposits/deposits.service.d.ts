import { PrismaService } from '../../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';
export declare class DepositsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    createDeposit({ userId, amount, method }: {
        userId: string;
        amount: number;
        method: string;
    }): Promise<{
        success: boolean;
        message: string;
        deposit: {
            id: string;
            status: import(".prisma/client").$Enums.DepositStatus;
            createdAt: Date;
            amount: Decimal;
            method: string;
            approvedBy: string | null;
            approvedAt: Date | null;
            walletId: string;
        };
    }>;
    getUserDeposits(userId: string): Promise<{
        id: string;
        status: import(".prisma/client").$Enums.DepositStatus;
        createdAt: Date;
        amount: Decimal;
        method: string;
        approvedBy: string | null;
        approvedAt: Date | null;
        walletId: string;
    }[]>;
    getPendingDeposits(): Promise<{
        id: string;
        status: import(".prisma/client").$Enums.DepositStatus;
        createdAt: Date;
        amount: Decimal;
        method: string;
        approvedBy: string | null;
        approvedAt: Date | null;
        walletId: string;
    }[]>;
    approveDeposit(id: string, userId: string): Promise<{
        id: string;
        status: import(".prisma/client").$Enums.DepositStatus;
        createdAt: Date;
        amount: Decimal;
        method: string;
        approvedBy: string | null;
        approvedAt: Date | null;
        walletId: string;
    }>;
    rejectDeposit(id: string, userId: string, reason?: string): Promise<{
        id: string;
        status: import(".prisma/client").$Enums.DepositStatus;
        createdAt: Date;
        amount: Decimal;
        method: string;
        approvedBy: string | null;
        approvedAt: Date | null;
        walletId: string;
    }>;
}
