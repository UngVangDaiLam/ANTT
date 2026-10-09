import { randomBytes } from 'node:crypto';
import { applyGrants, setupRoles } from '../../scripts/db-roles.js';

/**
 * Tên role dùng khi test. Role là đối tượng của cả cụm PostgreSQL (không riêng database test), nên
 * đặt tên khác hẳn role của bản triển khai.
 */
export const TEST_ROLES = Object.freeze({
  migrateRole: 'securenotes_test_migrate',
  appRole: 'securenotes_test_app',
});

/** URL kết nối cùng database nhưng bằng role khác. */
export function urlFor(adminUrl, user, password) {
  const url = new URL(adminUrl);
  url.username = user;
  url.password = password;
  return url.toString();
}

/**
 * Dựng hai role như bản triển khai (D90) trên database test và trả về Prisma client của role migrate
 * và role app. Mật khẩu sinh mới mỗi lần; `setupRoles` cập nhật lại nên chạy lại bao nhiêu lần cũng được.
 *
 * @param {import('@prisma/client').PrismaClient} admin kết nối bằng superuser
 * @param {string} adminUrl URL của kết nối superuser
 */
export async function connectWithRoles(admin, adminUrl) {
  const { PrismaClient } = await import('@prisma/client');
  const migratePassword = randomBytes(24).toString('base64url');
  const appPassword = randomBytes(24).toString('base64url');
  await setupRoles(admin, { ...TEST_ROLES, migratePassword, appPassword });

  const migrate = new PrismaClient({
    datasourceUrl: urlFor(adminUrl, TEST_ROLES.migrateRole, migratePassword),
  });
  await applyGrants(migrate, { appRole: TEST_ROLES.appRole });

  const app = new PrismaClient({
    datasourceUrl: urlFor(adminUrl, TEST_ROLES.appRole, appPassword),
  });
  return { migrate, app };
}
