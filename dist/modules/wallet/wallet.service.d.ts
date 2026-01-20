import { PrismaService } from '../../prisma/prisma.service';
import { Wallet } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
export declare class WalletService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getWalletByAccount(accountId: string): Promise<Wallet>;
    getWalletBalance(accountId: string): Promise<{
        balance: number;
        available: number;
        marginUsed: number;
    }>;
    checkAvailable(accountId: string, requiredAmount: number): Promise<boolean>;
    updateWalletBalance(accountId: string, amountChange: number, marginChange?: number): Promise<{
        id: string;
        balance: Decimal;
        available: Decimal;
        marginUsed: Decimal;
        equity: Decimal;
        freeMargin: Decimal;
        accountId: string;
    }>;
    getLedger(accountId: string): Promise<{
        id: string;
        createdAt: Date;
        type: import(".prisma/client").$Enums.LedgerType;
        amount: Decimal;
        walletId: string;
        reference: string | null;
    }[]>;
    getTransactions(accountId: string): Promise<{
        deposits: {
            id: string;
            status: import(".prisma/client").$Enums.DepositStatus;
            createdAt: Date;
            amount: Decimal;
            method: string;
            approvedBy: string | null;
            approvedAt: Date | null;
            walletId: string;
        }[];
        withdrawals: {
            id: string;
            status: import(".prisma/client").$Enums.WithdrawalStatus;
            createdAt: Date;
            amount: Decimal;
            approvedBy: string | null;
            approvedAt: Date | null;
            walletId: string;
        }[];
    }>;
}
