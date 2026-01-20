import { PrismaService } from '../../prisma/prisma.service';
import { AccountType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
export declare class AccountsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    createAccount(userId: string, type: AccountType, currency: string, leverage: number): Promise<{
        wallet: {
            id: string;
            balance: Decimal;
            available: Decimal;
            marginUsed: Decimal;
            equity: Decimal;
            freeMargin: Decimal;
            accountId: string;
        };
    } & {
        id: string;
        status: import(".prisma/client").$Enums.AccountStatus;
        createdAt: Date;
        type: import(".prisma/client").$Enums.AccountType;
        currency: string;
        leverage: number;
        userId: string;
    }>;
    getAccountsByUser(userId: string): Promise<({
        wallet: {
            id: string;
            balance: Decimal;
            available: Decimal;
            marginUsed: Decimal;
            equity: Decimal;
            freeMargin: Decimal;
            accountId: string;
        };
    } & {
        id: string;
        status: import(".prisma/client").$Enums.AccountStatus;
        createdAt: Date;
        type: import(".prisma/client").$Enums.AccountType;
        currency: string;
        leverage: number;
        userId: string;
    })[]>;
    getAllAccounts(): Promise<({
        user: {
            id: string;
            email: string;
            password: string;
            name: string | null;
            role: import(".prisma/client").$Enums.RoleName;
            status: import(".prisma/client").$Enums.UserStatus;
            createdAt: Date;
            updatedAt: Date;
        };
        wallet: {
            id: string;
            balance: Decimal;
            available: Decimal;
            marginUsed: Decimal;
            equity: Decimal;
            freeMargin: Decimal;
            accountId: string;
        };
    } & {
        id: string;
        status: import(".prisma/client").$Enums.AccountStatus;
        createdAt: Date;
        type: import(".prisma/client").$Enums.AccountType;
        currency: string;
        leverage: number;
        userId: string;
    })[]>;
}
