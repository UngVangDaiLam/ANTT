import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { TABLE_PRIVILEGES, applyGrants, validateRolesOptions } from '../scripts/db-roles.js';
import { TEST_ROLES, connectWithRoles } from './helpers/db-roles.js';

const valid = {
  migrateRole: 'securenotes_migrate',
  migratePassword: 'mat-khau-migrate',
  appRole: 'securenotes_app',
  appPassword: 'mat-khau-app',
};

describe('db-roles: cấu hình (D90)', () => {
  test('cấu hình hợp lệ được chấp nhận', () => {
    expect(() => validateRolesOptions(valid)).not.toThrow();
  });

  test.each([
    ['tên role có ký tự lạ', { appRole: 'app"; DROP TABLE "User"; --' }],
    ['tên role chữ hoa', { migrateRole: 'Migrate' }],
    ['hai role trùng tên', { appRole: valid.migrateRole }],
    ['thiếu mật khẩu role app', { appPassword: '' }],
    ['thiếu mật khẩu role migrate', { migratePassword: undefined }],
    ['hai role trùng mật khẩu', { appPassword: valid.migratePassword }],
  ])('từ chối: %s', (_label, override) => {
    expect(() => validateRolesOptions({ ...valid, ...override })).toThrow();
  });

  test('mọi model trong schema.prisma đều được khai báo quyền, không thừa bảng nào', () => {
    const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
    const models = [...schema.matchAll(/^model (\w+) \{/gm)].map((m) => m[1]);
    expect(Object.keys(TABLE_PRIVILEGES).sort()).toEqual(models.sort());
  });

  test('chỉ có quyền thao tác dữ liệu, LoginHistory không sửa được', () => {
    const allowed = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
    for (const privileges of Object.values(TABLE_PRIVILEGES)) {
      for (const p of privileges) expect(allowed.has(p)).toBe(true);
    }
    expect(TABLE_PRIVILEGES.LoginHistory).not.toContain('UPDATE');
  });
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('db-roles: quyền thật trên PostgreSQL (D90)', () => {
  let admin;
  let migrate;
  let app;

  /** Chạy câu SQL bằng một kết nối, trả về thông báo lỗi (hoặc null nếu chạy được). */
  async function errorOf(db, sql) {
    try {
      await db.$executeRawUnsafe(sql);
      return null;
    } catch (err) {
      return err.message;
    }
  }
  const DENIED = /permission denied|must be owner|must be superuser|not allowed/i;

  beforeAll(async () => {
    const { PrismaClient } = await import('@prisma/client');
    admin = new PrismaClient({ datasourceUrl: url });
    ({ migrate, app } = await connectWithRoles(admin, url));
    await admin.$executeRawUnsafe(
      'TRUNCATE "LoginHistory", "Session", "Share", "Note", "User" RESTART IDENTITY CASCADE',
    );
  });

  afterAll(() => Promise.all([admin, migrate, app].map((db) => db?.$disconnect())));

  test('hai role không có đặc quyền nào, role migrate sở hữu mọi bảng', async () => {
    const roles = await admin.$queryRaw`
      SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
      FROM pg_roles WHERE rolname IN (${TEST_ROLES.migrateRole}, ${TEST_ROLES.appRole})`;
    expect(roles).toHaveLength(2);
    for (const role of roles) {
      expect(role).toMatchObject({
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolreplication: false,
        rolbypassrls: false,
      });
    }
    const owners = await admin.$queryRaw`
      SELECT DISTINCT tableowner FROM pg_tables WHERE schemaname = 'public'`;
    expect(owners).toEqual([{ tableowner: TEST_ROLES.migrateRole }]);
  });

  test('role app đọc/ghi được dữ liệu như server cần', async () => {
    const userId = crypto.randomUUID();
    const sealed = { nonce: 'n', ciphertext: 'c' };
    await app.user.create({
      data: {
        id: userId,
        email: 'role-app@example.com',
        salt: 's',
        kdfOpslimit: 3,
        kdfMemlimit: 67108864,
        authKeyHash: new Uint8Array(32),
        wrappedVaultKey: sealed,
        x25519PublicKey: 'x',
        ed25519PublicKey: 'e',
        wrappedX25519PrivateKey: sealed,
        wrappedEd25519PrivateKey: sealed,
      },
    });
    await app.user.update({ where: { id: userId }, data: { salt: 's2' } });
    await app.loginHistory.create({
      data: { userId, emailAttempted: 'role-app@example.com', success: true },
    });
    expect(await app.loginHistory.count({ where: { userId } })).toBe(1);
    await app.loginHistory.deleteMany({ where: { userId } });
    await app.user.delete({ where: { id: userId } });
    expect(await app.user.count({ where: { id: userId } })).toBe(0);
  });

  test.each([
    ['sửa lịch sử đăng nhập', 'UPDATE "LoginHistory" SET success = true'],
    ['đọc bảng migration', 'SELECT * FROM "_prisma_migrations"'],
    ['TRUNCATE', 'TRUNCATE "Note" CASCADE'],
    ['DROP TABLE', 'DROP TABLE "Note"'],
    ['ALTER TABLE', 'ALTER TABLE "User" ADD COLUMN x int'],
    ['tạo bảng mới', 'CREATE TABLE "Ke_tan_cong" (id int)'],
    ['tự nâng lên superuser', `ALTER ROLE ${TEST_ROLES.appRole} SUPERUSER`],
    ['tạo role', 'CREATE ROLE ke_tan_cong LOGIN'],
    ['chạy lệnh hệ điều hành', "COPY (SELECT 1) TO PROGRAM 'id'"],
    ['đọc file trên máy chủ database', "SELECT pg_read_file('/etc/passwd')"],
    ['đọc hash mật khẩu của các role', 'SELECT rolpassword FROM pg_authid'],
  ])('role app bị chặn: %s', async (_label, sql) => {
    expect(await errorOf(app, sql)).toMatch(DENIED);
  });

  test.each([
    ['chạy lệnh hệ điều hành', "COPY (SELECT 1) TO PROGRAM 'id'"],
    ['tạo role', 'CREATE ROLE ke_tan_cong LOGIN'],
    ['tự nâng lên superuser', `ALTER ROLE ${TEST_ROLES.migrateRole} SUPERUSER`],
  ])('role migrate cũng không phải superuser: %s', async (_label, sql) => {
    expect(await errorOf(migrate, sql)).toMatch(DENIED);
  });

  test('bảng mới chưa khai báo quyền làm bước grants thất bại', async () => {
    await migrate.$executeRawUnsafe('CREATE TABLE "BangMoi" (id int)');
    try {
      await expect(applyGrants(migrate, { appRole: TEST_ROLES.appRole })).rejects.toThrow(
        /BangMoi/,
      );
      // Thất bại thì không cấp gì cho bảng mới.
      expect(await errorOf(app, 'SELECT * FROM "BangMoi"')).toMatch(DENIED);
    } finally {
      await migrate.$executeRawUnsafe('DROP TABLE "BangMoi"');
    }
  });
});
