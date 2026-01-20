import { AuditService } from './audit.service';
export declare class AuditController {
    private readonly auditService;
    constructor(auditService: AuditService);
    getLogs(): Promise<{
        id: string;
        createdAt: Date;
        userId: string | null;
        action: string;
        entity: string;
        entityId: string | null;
        metadata: import("@prisma/client/runtime/library").JsonValue | null;
    }[]>;
    createLog(body: any): Promise<{
        id: string;
        createdAt: Date;
        userId: string | null;
        action: string;
        entity: string;
        entityId: string | null;
        metadata: import("@prisma/client/runtime/library").JsonValue | null;
    }>;
}
