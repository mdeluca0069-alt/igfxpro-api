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
}
