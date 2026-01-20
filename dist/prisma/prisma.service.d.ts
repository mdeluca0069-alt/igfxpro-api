import { OnModuleInit, OnApplicationShutdown } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
export declare class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
    onModuleInit(): Promise<void>;
    onApplicationShutdown(signal?: string): Promise<void>;
    transaction<T>(fn: (prisma: PrismaClient) => Promise<T>): Promise<T>;
}
