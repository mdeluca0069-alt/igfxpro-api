import { PrismaService } from '../../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';
export declare class WithdrawalsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    createWithdrawal({ userId, amount }: {
        userId: string;
        amount: number;
    }): Promise<{
        success: boolean;
        message: string;
        withdrawal: {
            id: string;
            status: import(".prisma/client").$Enums.WithdrawalStatus;
            createdAt: Date;
            amount: Decimal;
            approvedBy: string | null;
            approvedAt: Date | null;
            walletId: string;
        };
    }>;
    getUserWithdrawals(userId: string): Promise<{
        id: string;
        status: import(".prisma/client").$Enums.WithdrawalStatus;
        createdAt: Date;
        amount: Decimal;
        approvedBy: string | null;
        approvedAt: Date | null;
        walletId: string;
    }[]>;
    getPendingWithdrawals(): Promise<{
        id: string;
        status: import(".prisma/client").$Enums.WithdrawalStatus;
        createdAt: Date;
        amount: Decimal;
        approvedBy: string | null;
        approvedAt: Date | null;
        walletId: string;
    }[]>;
    approveWithdrawal(id: string, userId: string): Promise<{
        id: string;
        status: import(".prisma/client").$Enums.WithdrawalStatus;
        createdAt: Date;
        amount: Decimal;
        approvedBy: string | null;
        approvedAt: Date | null;
        walletId: string;
    }>;
    rejectWithdrawal(id: string, userId: string, reason?: string): Promise<{
        id: string;
        status: import(".prisma/client").$Enums.WithdrawalStatus;
        createdAt: Date;
        amount: Decimal;
        approvedBy: string | null;
        approvedAt: Date | null;
        walletId: string;
    }>;
}
