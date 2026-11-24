import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AdminAdvisorsController } from './admin-advisors.controller';
import { AdminGuard } from './guards/admin.guard';

it('keeps account lookup and conversion behind the database-checked administrator guard', async () => {
  expect(Reflect.getMetadata(GUARDS_METADATA, AdminAdvisorsController)).toContain(AdminGuard);
  const accounts = { lookupExistingUser: jest.fn().mockResolvedValue({ user: { id: 'target' } }), convertExistingUser: jest.fn().mockResolvedValue({ changed: true }) };
  const controller = new AdminAdvisorsController(accounts as never, {} as never, {} as never);
  expect(Reflect.getMetadata(PATH_METADATA, controller.existingUser)).toBe('existing-user');
  expect(Reflect.getMetadata(PATH_METADATA, controller.convertUser)).toBe('existing-users/:userId/convert');
  await controller.existingUser('target@example.com');
  await controller.convertUser('target');
  expect(accounts.lookupExistingUser).toHaveBeenCalledWith('target@example.com');
  expect(accounts.convertExistingUser).toHaveBeenCalledWith('target');
});
