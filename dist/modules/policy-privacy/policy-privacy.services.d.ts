import { PrismaService } from '../../prisma/prisma.service';
export declare class LegalService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getContent(type: 'disclaimer' | 'policy' | 'terms'): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        type: string;
        title: string;
        content: string;
        version: number;
    }>;
}
