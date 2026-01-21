import { LedgerService } from './ledger.service';
export declare class LedgerController {
    private readonly ledgerService;
    constructor(ledgerService: LedgerService);
    getLedger(walletId: string): Promise<{
        id: string;
        amount: import("@prisma/client/runtime/library").Decimal;
        createdAt: Date;
        walletId: string;
        type: import(".prisma/client").$Enums.LedgerType;
        reference: string | null;
    }[]>;
    createEntry(body: {
        walletId: string;
        type: string;
        amount: number;
        reference?: string;
    }): Promise<{
        id: string;
        amount: import("@prisma/client/runtime/library").Decimal;
        createdAt: Date;
        walletId: string;
        type: import(".prisma/client").$Enums.LedgerType;
        reference: string | null;
    }>;
}
