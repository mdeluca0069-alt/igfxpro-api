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
            amount: Decimal;
            status: import(".prisma/client").$Enums.DepositStatus;
            approvedBy: string | null;
            approvedAt: Date | null;
            createdAt: Date;
            walletId: string;
            method: string;
        };
    }>;
    getUserDeposits(userId: string): Promise<{
        id: string;
        amount: Decimal;
        status: import(".prisma/client").$Enums.DepositStatus;
        approvedBy: string | null;
        approvedAt: Date | null;
        createdAt: Date;
        walletId: string;
        method: string;
    }[]>;
    getPendingDeposits(): Promise<{
        id: string;
        amount: Decimal;
        status: import(".prisma/client").$Enums.DepositStatus;
        approvedBy: string | null;
        approvedAt: Date | null;
        createdAt: Date;
        walletId: string;
        method: string;
    }[]>;
    approveDeposit(id: string, userId: string): Promise<{
        id: string;
        amount: Decimal;
        status: import(".prisma/client").$Enums.DepositStatus;
        approvedBy: string | null;
        approvedAt: Date | null;
        createdAt: Date;
        walletId: string;
        method: string;
    }>;
    rejectDeposit(id: string, userId: string, reason?: string): Promise<{
        id: string;
        amount: Decimal;
        status: import(".prisma/client").$Enums.DepositStatus;
        approvedBy: string | null;
        approvedAt: Date | null;
        createdAt: Date;
        walletId: string;
        method: string;
    }>;
}
