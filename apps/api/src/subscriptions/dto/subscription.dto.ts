import { IsObject, IsUUID, ValidateIf } from 'class-validator';

export class AssignPlanDto {
  @IsUUID()
  planId: string;
}

export class SetOverridesDto {
  // null explicitly clears every override (back to "inherit the plan verbatim"); an object
  // sets/replaces the whole bag (not a per-key patch -- the admin UI always submits the
  // full intended state, same shape as plan.entitlements itself). @ValidateIf's condition
  // is what lets null through while still rejecting an omitted (undefined) field -- unlike
  // @IsOptional, which would skip validation for undefined too.
  @ValidateIf((_, value) => value !== null)
  @IsObject()
  overrides: Record<string, unknown> | null;
}
