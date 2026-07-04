import { IsIn, IsNumber, IsOptional, IsPositive, IsString, Max, MinLength } from "class-validator";

export class NewOrderDto {
  @IsString()
  @MinLength(3)
  symbol!: string;

  @IsIn(["BUY", "SELL"])
  side!: "BUY" | "SELL";

  @IsOptional()
  @IsIn(["MARKET", "LIMIT", "STOP", "STOP_LIMIT", "TRAILING_STOP"])
  type?: string;

  @IsNumber()
  @IsPositive()
  quantity!: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  price?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  stopLoss?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  takeProfit?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  @Max(500)
  leverage?: number;

  @IsOptional()
  @IsString()
  clientOrderId?: string;
}

export class ModifyOrderDto {
  @IsOptional()
  @IsNumber()
  stopLoss?: number;

  @IsOptional()
  @IsNumber()
  takeProfit?: number;
}

export class ClosePositionDto {
  @IsOptional()
  @IsNumber()
  @IsPositive()
  quantity?: number;
}
