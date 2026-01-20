import { PrismaService } from '../../prisma/prisma.service';
import { User, RoleName } from '@prisma/client';
export declare class UsersService {
    private prisma;
    constructor(prisma: PrismaService);
    createUser(email: string, password: string, role?: RoleName): Promise<User>;
    getUserByEmail(email: string): Promise<User | null>;
}
