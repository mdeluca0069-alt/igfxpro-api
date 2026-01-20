import { UsersService } from './users.service';
export declare class UsersController {
    private usersService;
    constructor(usersService: UsersService);
    getUser(email: string): Promise<{
        id: string;
        email: string;
        password: string;
        name: string | null;
        role: import(".prisma/client").$Enums.RoleName;
        status: import(".prisma/client").$Enums.UserStatus;
        createdAt: Date;
        updatedAt: Date;
    }>;
}
