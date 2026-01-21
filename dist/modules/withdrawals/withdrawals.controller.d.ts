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
            amount: import("@prisma/client/runtime/library").Decimal;
            status: import(".prisma/client").$Enums.WithdrawalStatus;
            approvedBy: string | null;
            approvedAt: Date | null;
            createdAt: Date;
            walletId: string;
        };
    }>;
    getMyWithdrawals(req: any): Promise<{
        id: string;
        amount: import("@prisma/client/runtime/library").Decimal;
        status: import(".prisma/client").$Enums.WithdrawalStatus;
        approvedBy: string | null;
        approvedAt: Date | null;
        createdAt: Date;
        walletId: string;
    }[]>;
    getPendingWithdrawals(): Promise<{
        id: string;
        amount: import("@prisma/client/runtime/library").Decimal;
        status: import(".prisma/client").$Enums.WithdrawalStatus;
        approvedBy: string | null;
        approvedAt: Date | null;
        createdAt: Date;
        walletId: string;
    }[]>;
    approveWithdrawal(id: string, req: any): Promise<{
        id: string;
        amount: import("@prisma/client/runtime/library").Decimal;
        status: import(".prisma/client").$Enums.WithdrawalStatus;
        approvedBy: string | null;
        approvedAt: Date | null;
        createdAt: Date;
        walletId: string;
    }>;
    rejectWithdrawal(id: string, req: any, body: {
        reason?: string;
    }): Promise<{
        id: string;
        amount: import("@prisma/client/runtime/library").Decimal;
        status: import(".prisma/client").$Enums.WithdrawalStatus;
        approvedBy: string | null;
        approvedAt: Date | null;
        createdAt: Date;
        walletId: string;
    }>;
}
