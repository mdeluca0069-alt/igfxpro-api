import { PrismaService } from '../prisma/prisma.service';
import { AccountType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
export declare class AccountController {
    private readonly prisma;
    constructor(prisma: PrismaService);
    createAccount(req: any, body: {
        currency: string;
        leverage: number;
        type: AccountType;
    }): Promise<{
        success: boolean;
        message: string;
        account: {
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
        };
    }>;
    getMyAccounts(req: any): Promise<({
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
