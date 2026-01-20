import { WalletService } from './wallet.service';
import { PrismaService } from '../../prisma/prisma.service';
export declare class WalletController {
    private readonly walletService;
    private readonly prisma;
    constructor(walletService: WalletService, prisma: PrismaService);
    getWallet(accountId: string): Promise<{
        balance: number;
        available: number;
        marginUsed: number;
    }>;
    checkAvailable(accountId: string, required: string): Promise<{
        success: boolean;
        message: string;
        required: number;
    }>;
    getLedger(accountId: string): Promise<{
        type: import(".prisma/client").$Enums.LedgerType;
        amount: number;
        reference: string;
        createdAt: Date;
    }[]>;
}
