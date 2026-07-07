import { IsIn, IsOptional, IsString } from 'class-validator';
import { SalonStatus } from '../salon.entity';

export class AdminSalonQueryDto {
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected', 'suspended'])
  status?: SalonStatus;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(['women', 'men'])
  genderTarget?: 'women' | 'men';
}
