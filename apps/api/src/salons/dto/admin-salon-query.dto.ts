import { IsIn, IsOptional, IsString } from 'class-validator';

export class AdminSalonQueryDto {
  @IsOptional()
  @IsIn(['all', 'pending', 'approved', 'rejected', 'suspended'])
  status?: 'all' | 'pending' | 'approved' | 'rejected' | 'suspended';

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
