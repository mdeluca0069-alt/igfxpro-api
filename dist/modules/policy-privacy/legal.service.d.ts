import { PrismaService } from '../../prisma/prisma.service';
export declare class LegalService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getContent(type: string): Promise<{
        type: string;
        content: string;
    }>;
    updateContent(type: string, content: string): Promise<{
        type: string;
        content: string;
    }>;
}
