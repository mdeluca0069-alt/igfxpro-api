import { WithdrawalsService } from './withdrawals.service';
export declare class WithdrawalsController {
    private readonly withdrawalsService;
    constructor(withdrawalsService: WithdrawalsService);
    createWithdrawal(req: any, body: {
        amount: number;
    }): Promise<{
        success: boolean;
        message: string;
        withdrawal: {
            id: string;
            status: import(".prisma/client").$Enums.WithdrawalStatus;
            createdAt: Date;
            amount: import("@prisma/client/runtime/library").Decimal;
            approvedBy: string | null;
            approvedAt: Date | null;
            walletId: string;
        };
    }>;
    getMyWithdrawals(req: any): Promise<{
        id: string;
        status: import(".prisma/client").$Enums.WithdrawalStatus;
        createdAt: Date;
        amount: import("@prisma/client/runtime/library").Decimal;
        approvedBy: string | null;
        approvedAt: Date | null;
        walletId: string;
    }[]>;
    getPendingWithdrawals(): Promise<{
        id: string;
        status: import(".prisma/client").$Enums.WithdrawalStatus;
        createdAt: Date;
        amount: import("@prisma/client/runtime/library").Decimal;
        approvedBy: string | null;
        approvedAt: Date | null;
        walletId: string;
    }[]>;
    approveWithdrawal(id: string, req: any): Promise<{
        id: string;
        status: import(".prisma/client").$Enums.WithdrawalStatus;
        createdAt: Date;
        amount: import("@prisma/client/runtime/library").Decimal;
        approvedBy: string | null;
        approvedAt: Date | null;
        walletId: string;
    }>;
    rejectWithdrawal(id: string, req: any, body: {
        reason?: string;
    }): Promise<{
        id: string;
        status: import(".prisma/client").$Enums.WithdrawalStatus;
        createdAt: Date;
        amount: import("@prisma/client/runtime/library").Decimal;
        approvedBy: string | null;
        approvedAt: Date | null;
        walletId: string;
    }>;
}
