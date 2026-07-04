import { IsNumber, IsOptional, IsPositive, IsString } from "class-validator";

export class DepositDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsString()
  method!: string;

  @IsOptional()
  @IsString()
  details?: string;
}

export class WithdrawDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsString()
  destination!: string;

  @IsString()
  method!: string;
}
