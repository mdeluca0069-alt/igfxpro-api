import { UsersService } from './users.service';
export declare class UsersController {
    private usersService;
    constructor(usersService: UsersService);
    getUser(email: string): Promise<{
        id: string;
        status: import(".prisma/client").$Enums.UserStatus;
        createdAt: Date;
        name: string | null;
        email: string;
        password: string;
        role: import(".prisma/client").$Enums.RoleName;
        updatedAt: Date;
    }>;
}
