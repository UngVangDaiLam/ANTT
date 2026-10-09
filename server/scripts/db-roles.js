/**
 * Tách quyền trên PostgreSQL theo nguyên tắc quyền tối thiểu (D90).
 *
 *   superuser (POSTGRES_USER) : chỉ dùng cho bước `roles` dưới đây, server không bao giờ cầm.
 *   role migrate              : chủ schema `public` và các bảng, chỉ bước migrate dùng.
 *   role app                  : server dùng lúc chạy, chỉ có quyền đọc/ghi DỮ LIỆU theo
 *                               `TABLE_PRIVILEGES`; không DROP, ALTER, TRUNCATE, tạo bảng hay đọc
 *                               bảng `_prisma_migrations` được.
 *
 * Hai bước, đều chạy lại bao nhiêu lần cũng được (docker-compose.prod.yml chạy mỗi lần `up`):
 *
 *   node scripts/db-roles.js roles   # DATABASE_URL = superuser. Tạo/cập nhật hai role, chuyển quyền
 *                                    # sở hữu schema và bảng (kể cả của bản triển khai cũ) cho role migrate.
 *   node scripts/db-roles.js grants  # DATABASE_URL = role migrate, SAU `prisma migrate deploy`.
 *                                    # Cấp lại đúng quyền trong TABLE_PRIVILEGES cho role app.
 *
 * Biến môi trường: MIGRATE_DB_USER, APP_DB_USER, và với bước `roles` thêm MIGRATE_DB_PASSWORD,
 * APP_DB_PASSWORD. Không có giá trị mặc định: thiếu là dừng.
 *
 * Không log mật khẩu: mật khẩu chỉ nằm trong câu ALTER ROLE gửi tới PostgreSQL (lưu dạng SCRAM).
 */
import { pathToFileURL } from 'node:url';

/**
 * Quyền của role app trên từng bảng. Bảng không có ở đây thì role app KHÔNG có quyền gì (từ chối
 * mặc định); bảng có trong DB mà không có ở đây thì bước `grants` báo lỗi để migration thêm bảng mới
 * phải quyết định quyền ngay, không lặng lẽ làm server hỏng.
 *
 * Không bảng nào có TRUNCATE, REFERENCES hay TRIGGER.
 */
export const TABLE_PRIVILEGES = Object.freeze({
  User: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  Note: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  Share: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  Session: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  // Lịch sử đăng nhập không sửa được, kể cả khi server bị chiếm quyền. DELETE vẫn cần cho xóa tài
  // khoản (D86). SetNull khi xóa User do khóa ngoại thực hiện bằng quyền của chủ bảng, không cần UPDATE.
  LoginHistory: ['SELECT', 'INSERT', 'DELETE'],
});

/** Bảng của Prisma, chỉ role migrate được đụng tới. */
const MIGRATIONS_TABLE = '_prisma_migrations';

const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/** Thuộc tính của cả hai role: đăng nhập được, ngoài ra không có đặc quyền nào. */
const ROLE_ATTRIBUTES =
  'LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT';

function checkRoleName(name, label) {
  if (typeof name !== 'string' || !ROLE_NAME.test(name)) {
    throw new Error(`${label} phải là tên role PostgreSQL hợp lệ (a-z, 0-9, _).`);
  }
}

/**
 * Kiểm tra cấu hình bước `roles`.
 * @param {{ migrateRole: string, migratePassword: string, appRole: string, appPassword: string }} options
 */
export function validateRolesOptions({ migrateRole, migratePassword, appRole, appPassword }) {
  checkRoleName(migrateRole, 'MIGRATE_DB_USER');
  checkRoleName(appRole, 'APP_DB_USER');
  if (migrateRole === appRole) throw new Error('MIGRATE_DB_USER và APP_DB_USER phải khác nhau.');
  for (const [label, value] of [
    ['MIGRATE_DB_PASSWORD', migratePassword],
    ['APP_DB_PASSWORD', appPassword],
  ]) {
    if (typeof value !== 'string' || value.length === 0) throw new Error(`Thiếu ${label}.`);
  }
  if (migratePassword === appPassword) {
    throw new Error('MIGRATE_DB_PASSWORD và APP_DB_PASSWORD phải khác nhau.');
  }
}

/**
 * Dựng câu SQL có định danh/chuỗi do PostgreSQL tự trích dẫn (`format` với %I, %L), không ghép chuỗi
 * bằng tay.
 */
async function formatSql(db, template, ...args) {
  const placeholders = args.map((_, i) => `$${i + 2}::text`).join(', ');
  const rows = await db.$queryRawUnsafe(
    `SELECT format($1::text${placeholders ? `, ${placeholders}` : ''}) AS sql`,
    template,
    ...args,
  );
  return rows[0].sql;
}

async function run(db, template, ...args) {
  await db.$executeRawUnsafe(await formatSql(db, template, ...args));
}

async function upsertRole(db, name, password) {
  const exists = await db.$queryRaw`SELECT 1 FROM pg_roles WHERE rolname = ${name}`;
  const verb = exists.length > 0 ? 'ALTER' : 'CREATE';
  await run(db, `${verb} ROLE %I WITH ${ROLE_ATTRIBUTES} PASSWORD %L`, name, password);
}

/**
 * Bước 1, chạy bằng superuser: tạo hoặc cập nhật hai role, khóa database và schema lại, chuyển quyền
 * sở hữu mọi đối tượng trong schema `public` cho role migrate.
 * @param {import('@prisma/client').PrismaClient} db kết nối bằng superuser
 * @param {{ migrateRole: string, migratePassword: string, appRole: string, appPassword: string }} options
 */
export async function setupRoles(db, options) {
  validateRolesOptions(options);
  const { migrateRole, migratePassword, appRole, appPassword } = options;

  await db.$transaction(async (tx) => {
    await upsertRole(tx, migrateRole, migratePassword);
    await upsertRole(tx, appRole, appPassword);

    const [{ name: database }] = await tx.$queryRaw`SELECT current_database() AS name`;
    await run(tx, 'REVOKE ALL ON DATABASE %I FROM PUBLIC', database);
    await run(tx, 'GRANT CONNECT ON DATABASE %I TO %I, %I', database, migrateRole, appRole);

    await run(tx, 'ALTER SCHEMA public OWNER TO %I', migrateRole);
    await tx.$executeRawUnsafe('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    await run(tx, 'GRANT USAGE ON SCHEMA public TO %I', appRole);

    // Bản triển khai cũ: bảng do superuser tạo. Sequence gắn với cột (serial/identity) đi theo bảng
    // của nó, đổi riêng sẽ lỗi nên bỏ qua.
    const objects = await tx.$queryRaw`
      SELECT c.relname AS name,
             CASE c.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW'
                            WHEN 'S' THEN 'SEQUENCE' ELSE 'TABLE' END AS kind
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
        AND pg_get_userbyid(c.relowner) <> ${migrateRole}
        AND NOT EXISTS (SELECT 1 FROM pg_depend d
                        WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
                          AND d.deptype IN ('a', 'i'))`;
    for (const { name, kind } of objects) {
      await run(tx, `ALTER ${kind} public.%I OWNER TO %I`, name, migrateRole);
    }
    const types = await tx.$queryRaw`
      SELECT t.typname AS name
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typtype = 'e'
        AND pg_get_userbyid(t.typowner) <> ${migrateRole}`;
    for (const { name } of types) {
      await run(tx, 'ALTER TYPE public.%I OWNER TO %I', name, migrateRole);
    }
  });
}

/**
 * Bước 2, chạy bằng role migrate (chủ bảng) sau `prisma migrate deploy`: thu hồi hết rồi cấp lại đúng
 * `TABLE_PRIVILEGES` cho role app.
 * @param {import('@prisma/client').PrismaClient} db kết nối bằng role migrate
 * @param {{ appRole: string }} options
 */
export async function applyGrants(db, { appRole }) {
  checkRoleName(appRole, 'APP_DB_USER');

  await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
    const tables = new Set(rows.map((row) => row.tablename));
    tables.delete(MIGRATIONS_TABLE);

    const unknown = [...tables].filter((t) => !Object.hasOwn(TABLE_PRIVILEGES, t));
    if (unknown.length > 0) {
      throw new Error(
        `Bảng chưa có trong TABLE_PRIVILEGES: ${unknown.join(', ')}. Khai báo quyền trước khi triển khai.`,
      );
    }
    const missing = Object.keys(TABLE_PRIVILEGES).filter((t) => !tables.has(t));
    if (missing.length > 0) {
      throw new Error(
        `Không thấy bảng ${missing.join(', ')}: migration chưa chạy hoặc lệch schema.`,
      );
    }

    await run(tx, 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', appRole);
    await run(tx, 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', appRole);
    for (const [table, privileges] of Object.entries(TABLE_PRIVILEGES)) {
      await run(tx, `GRANT ${privileges.join(', ')} ON TABLE public.%I TO %I`, table, appRole);
    }
  });
}

async function main(step, env) {
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient();
  try {
    if (step === 'roles') {
      await setupRoles(db, {
        migrateRole: env.MIGRATE_DB_USER,
        migratePassword: env.MIGRATE_DB_PASSWORD,
        appRole: env.APP_DB_USER,
        appPassword: env.APP_DB_PASSWORD,
      });
      console.log(`Đã tạo/cập nhật role ${env.MIGRATE_DB_USER} và ${env.APP_DB_USER}.`);
    } else if (step === 'grants') {
      await applyGrants(db, { appRole: env.APP_DB_USER });
      console.log(`Đã cấp quyền tối thiểu cho ${env.APP_DB_USER}.`);
    } else {
      throw new Error('Dùng: node scripts/db-roles.js roles|grants');
    }
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2], process.env).catch((err) => {
    // Chỉ in thông báo, không in cả đối tượng lỗi (có thể chứa câu SQL kèm mật khẩu).
    console.error(err.message);
    process.exit(1);
  });
}
