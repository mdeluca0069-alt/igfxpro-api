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
        accountId: string;
        balance: Decimal;
        available: Decimal;
        marginUsed: Decimal;
        equity: Decimal;
        freeMargin: Decimal;
    }>;
    getLedger(accountId: string): Promise<{
        id: string;
        amount: Decimal;
        createdAt: Date;
        walletId: string;
        type: import(".prisma/client").$Enums.LedgerType;
        reference: string | null;
    }[]>;
    getTransactions(accountId: string): Promise<{
        deposits: {
            id: string;
            amount: Decimal;
            status: import(".prisma/client").$Enums.DepositStatus;
            approvedBy: string | null;
            approvedAt: Date | null;
            createdAt: Date;
            walletId: string;
            method: string;
        }[];
        withdrawals: {
            id: string;
            amount: Decimal;
            status: import(".prisma/client").$Enums.WithdrawalStatus;
            approvedBy: string | null;
            approvedAt: Date | null;
            createdAt: Date;
            walletId: string;
        }[];
    }>;
}
