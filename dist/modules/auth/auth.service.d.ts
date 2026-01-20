import { PrismaService } from '../../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
export declare class AuthService {
    private readonly prisma;
    private readonly jwtService;
    constructor(prisma: PrismaService, jwtService: JwtService);
    login(dto: {
        email: string;
        password: string;
    }): Promise<{
        accessToken: string;
        user: {
            id: string;
            email: string;
            role: import(".prisma/client").$Enums.RoleName;
            permissions: any[];
        };
    }>;
}
