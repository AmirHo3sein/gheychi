import { IsIn, IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';

export class UpdateSalonStatusDto {
  @IsIn(['approved', 'rejected', 'suspended'])
  status: 'approved' | 'rejected' | 'suspended';

  /**
   * Required (non-empty, <=500 chars) when status is 'rejected' or 'suspended'.
   * When status is 'approved', @ValidateIf skips the whole chain, so undefined,
   * '', and null all pass -- a reason simply isn't required on approve.
   */
  @ValidateIf((o: UpdateSalonStatusDto) => o.status === 'rejected' || o.status === 'suspended')
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason?: string;
}
