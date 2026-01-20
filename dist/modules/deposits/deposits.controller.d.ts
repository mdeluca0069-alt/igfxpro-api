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
            status: import(".prisma/client").$Enums.DepositStatus;
            createdAt: Date;
            amount: import("@prisma/client/runtime/library").Decimal;
            method: string;
            approvedBy: string | null;
            approvedAt: Date | null;
            walletId: string;
        };
    }>;
    getMyDeposits(req: any): Promise<{
        id: string;
        status: import(".prisma/client").$Enums.DepositStatus;
        createdAt: Date;
        amount: import("@prisma/client/runtime/library").Decimal;
        method: string;
        approvedBy: string | null;
        approvedAt: Date | null;
        walletId: string;
    }[]>;
    getPendingDeposits(): Promise<{
        id: string;
        status: import(".prisma/client").$Enums.DepositStatus;
        createdAt: Date;
        amount: import("@prisma/client/runtime/library").Decimal;
        method: string;
        approvedBy: string | null;
        approvedAt: Date | null;
        walletId: string;
    }[]>;
    approveDeposit(id: string, req: any): Promise<{
        id: string;
        status: import(".prisma/client").$Enums.DepositStatus;
        createdAt: Date;
        amount: import("@prisma/client/runtime/library").Decimal;
        method: string;
        approvedBy: string | null;
        approvedAt: Date | null;
        walletId: string;
    }>;
    rejectDeposit(id: string, req: any, body: {
        reason?: string;
    }): Promise<{
        id: string;
        status: import(".prisma/client").$Enums.DepositStatus;
        createdAt: Date;
        amount: import("@prisma/client/runtime/library").Decimal;
        method: string;
        approvedBy: string | null;
        approvedAt: Date | null;
        walletId: string;
    }>;
}
