import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, Max, Min } from "class-validator";

export class AutopilotConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(["CONSERVATIVE", "BALANCED", "AGGRESSIVE"])
  mode?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.4)
  @Max(0.99)
  minConfidence?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.005)
  @Max(0.15)
  maxRiskPerTrade?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxOpenTrades?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  maxExposurePct?: number;

  @IsOptional()
  @IsArray()
  allowedSymbols?: string[];

  @IsOptional()
  @IsArray()
  blockedSymbols?: string[];

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(50)
  stopDrawdownPct?: number;

  @IsOptional()
  @IsNumber()
  @Min(10)
  @Max(100)
  capitalPct?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(180)
  eventLockMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  maxDailyTrades?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(5)
  breakEvenTriggerR?: number;

  @IsOptional()
  @IsBoolean()
  trailingStopEnabled?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(5)
  trailingActivationR?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(10)
  atrTrailMultiple?: number;

  @IsOptional()
  @IsBoolean()
  regimeExitEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  maxHoursOpen?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(50)
  maxDailyLossPct?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  maxSpreadBps?: number;
}
