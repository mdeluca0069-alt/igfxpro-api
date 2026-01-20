import { PrismaService } from '../../prisma/prisma.service';
export declare class AuditService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getLogs(limit?: number): Promise<{
        id: string;
        createdAt: Date;
        userId: string | null;
        action: string;
        entity: string;
        entityId: string | null;
        metadata: import("@prisma/client/runtime/library").JsonValue | null;
    }[]>;
    createLog(data: any): Promise<{
        id: string;
        createdAt: Date;
        userId: string | null;
        action: string;
        entity: string;
        entityId: string | null;
        metadata: import("@prisma/client/runtime/library").JsonValue | null;
    }>;
}
