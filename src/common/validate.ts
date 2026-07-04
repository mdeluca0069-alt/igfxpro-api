import "reflect-metadata";
import { plainToInstance, type ClassConstructor } from "class-transformer";
import { validate } from "class-validator";
import { BadRequestException } from "./http-exceptions";

export async function validateBody<T extends object>(cls: ClassConstructor<T>, body: unknown): Promise<T> {
  const instance = plainToInstance(cls, body);
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });

  if (errors.length > 0) {
    const message = errors
      .flatMap((e) => Object.values(e.constraints ?? {}))
      .join(", ");
    throw new BadRequestException(message || "Dati non validi");
  }

  return instance;
}
