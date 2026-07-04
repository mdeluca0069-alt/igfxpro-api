import { IsBoolean, IsIn, IsNumber, IsOptional, IsPositive, IsString } from "class-validator";

export class CapitalOpDto {
  @IsString()
  userId!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  note?: string;
}

export class DocumentReviewDto {
  @IsString()
  userId!: string;

  @IsString()
  documentId!: string;

  @IsIn(["APPROVED", "REJECTED"])
  status!: string;

  @IsOptional()
  @IsString()
  rejectionReason?: string;
}

export class LedgerReviewDto {
  @IsString()
  userId!: string;

  @IsString()
  ledgerId!: string;

  @IsIn(["APPROVED", "REJECTED"])
  status!: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class TierUpdateDto {
  @IsString()
  userId!: string;

  @IsIn(["STANDARD", "GOLD", "PLATINUM", "VIP", "ENTERPRISE"])
  tier!: string;
}

export class KycUpdateDto {
  @IsString()
  userId!: string;

  @IsIn(["not_started", "pending", "approved", "rejected"])
  kycStatus!: string;
}

export class LiquidityUpdateDto {
  @IsString()
  symbol!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsNumber()
  spread?: number;
}

export class KillSwitchDto {
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsString()
  reason?: string;
}
