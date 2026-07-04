import { IsEmail, IsIn, IsOptional, IsString, Length, MinLength } from "class-validator";

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;

  @IsOptional()
  @IsString()
  authKey?: string;
}

export class RegisterDto extends LoginDto {
  @IsString()
  @MinLength(2)
  fullName!: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  country?: string;

  @IsOptional()
  @IsIn(["STANDARD", "GOLD", "PLATINUM", "VIP", "ENTERPRISE"])
  tier?: string;
}
