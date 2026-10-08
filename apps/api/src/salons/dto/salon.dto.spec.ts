import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateSalonDto, UpdateSalonDto } from './salon.dto';

const base = { name: 'سالن زیبا', genderTarget: 'women', address: 'خیابان آزادی ۱۲', city: 'تهران', lat: 35.7, lng: 51.4, categoryIds: [1] };

describe('contactPhone on Create/UpdateSalonDto', () => {
  it('normalises Persian digits and separators on update', async () => {
    const dto = plainToInstance(UpdateSalonDto, { contactPhone: '۰۹۱۲-۳۴۵ ۶۷۸۹' });
    expect(await validate(dto)).toEqual([]);
    expect(dto.contactPhone).toBe('09123456789');
  });

  it("clears with '' or null", async () => {
    for (const contactPhone of ['', null]) {
      const dto = plainToInstance(UpdateSalonDto, { contactPhone });
      expect(await validate(dto)).toEqual([]);
      expect(dto.contactPhone).toBeNull();
    }
  });

  it('leaves the field undefined when omitted (so an update does not touch it)', async () => {
    const dto = plainToInstance(UpdateSalonDto, { name: 'سالن' });
    expect(dto.contactPhone).toBeUndefined();
  });

  it.each(['12345', '0912345678', '+989123456789', '09123456abc', '0012345678901', 12345])(
    'rejects %p with a Persian message',
    async (contactPhone) => {
      const errors = await validate(plainToInstance(UpdateSalonDto, { contactPhone }));
      expect(errors).toHaveLength(1);
      expect(Object.values(errors[0].constraints ?? {})[0]).toContain('شماره تماس');
    },
  );

  it('is optional on create and accepts a landline', async () => {
    expect(await validate(plainToInstance(CreateSalonDto, base))).toEqual([]);
    const dto = plainToInstance(CreateSalonDto, { ...base, contactPhone: '021 8888 7777' });
    expect(await validate(dto)).toEqual([]);
    expect(dto.contactPhone).toBe('02188887777');
  });

  it('the whitelisting ValidationPipe strips the admin-only timeout columns from UpdateSalonDto', async () => {
    const dto = plainToInstance(UpdateSalonDto, { name: 'سالن', approvalTimeoutMinutes: 1, paymentTimeoutMinutes: 1 });
    await validate(dto, { whitelist: true });
    expect(dto).not.toHaveProperty('approvalTimeoutMinutes');
    expect(dto).not.toHaveProperty('paymentTimeoutMinutes');
  });
});
