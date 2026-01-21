import { DepositsService } from './deposits.service';
export declare class DepositsController {
    private readonly depositsService;
    constructor(depositsService: DepositsService);
    createDeposit(req: any, body: {
        amount: number;
        method: string;
    }): Promise<{
        success: boolean;
        message: string;
        deposit: {
            id: string;
            amount: import("@prisma/client/runtime/library").Decimal;
            status: import(".prisma/client").$Enums.DepositStatus;
            approvedBy: string | null;
            approvedAt: Date | null;
            createdAt: Date;
            walletId: string;
            method: string;
        };
    }>;
    getMyDeposits(req: any): Promise<{
        id: string;
        amount: import("@prisma/client/runtime/library").Decimal;
        status: import(".prisma/client").$Enums.DepositStatus;
        approvedBy: string | null;
        approvedAt: Date | null;
        createdAt: Date;
        walletId: string;
        method: string;
    }[]>;
    getPendingDeposits(): Promise<{
        id: string;
        amount: import("@prisma/client/runtime/library").Decimal;
        status: import(".prisma/client").$Enums.DepositStatus;
        approvedBy: string | null;
        approvedAt: Date | null;
        createdAt: Date;
        walletId: string;
        method: string;
    }[]>;
    approveDeposit(id: string, req: any): Promise<{
        id: string;
        amount: import("@prisma/client/runtime/library").Decimal;
        status: import(".prisma/client").$Enums.DepositStatus;
        approvedBy: string | null;
        approvedAt: Date | null;
        createdAt: Date;
        walletId: string;
        method: string;
    }>;
    rejectDeposit(id: string, req: any, body: {
        reason?: string;
    }): Promise<{
        id: string;
        amount: import("@prisma/client/runtime/library").Decimal;
        status: import(".prisma/client").$Enums.DepositStatus;
        approvedBy: string | null;
        approvedAt: Date | null;
        createdAt: Date;
        walletId: string;
        method: string;
    }>;
}
