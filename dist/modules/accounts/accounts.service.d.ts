import { PrismaService } from '../../prisma/prisma.service';
import { AccountType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
export declare class AccountsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    createAccount(userId: string, type: AccountType, currency: string, leverage: number): Promise<{
        wallet: {
            id: string;
            accountId: string;
            balance: Decimal;
            available: Decimal;
            marginUsed: Decimal;
            equity: Decimal;
            freeMargin: Decimal;
        };
    } & {
        id: string;
        status: import(".prisma/client").$Enums.AccountStatus;
        createdAt: Date;
        userId: string;
        type: import(".prisma/client").$Enums.AccountType;
        currency: string;
        leverage: number;
    }>;
    getAccountsByUser(userId: string): Promise<({
        wallet: {
            id: string;
            accountId: string;
            balance: Decimal;
            available: Decimal;
            marginUsed: Decimal;
            equity: Decimal;
            freeMargin: Decimal;
        };
    } & {
        id: string;
        status: import(".prisma/client").$Enums.AccountStatus;
        createdAt: Date;
        userId: string;
        type: import(".prisma/client").$Enums.AccountType;
        currency: string;
        leverage: number;
    })[]>;
    getAllAccounts(): Promise<({
        wallet: {
            id: string;
            accountId: string;
            balance: Decimal;
            available: Decimal;
            marginUsed: Decimal;
            equity: Decimal;
            freeMargin: Decimal;
        };
        user: {
            id: string;
            status: import(".prisma/client").$Enums.UserStatus;
            createdAt: Date;
            name: string | null;
            email: string;
            password: string;
            role: import(".prisma/client").$Enums.RoleName;
            updatedAt: Date;
        };
    } & {
        id: string;
        status: import(".prisma/client").$Enums.AccountStatus;
        createdAt: Date;
        userId: string;
        type: import(".prisma/client").$Enums.AccountType;
        currency: string;
        leverage: number;
    })[]>;
}
