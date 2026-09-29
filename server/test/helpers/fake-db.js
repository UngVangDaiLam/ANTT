/**
 * DB giả trong bộ nhớ, cùng giao diện với phần Prisma mà server dùng.
 *
 * Cố ý bắt chước những chỗ Prisma thật khác một Map thông thường, vì đó là chỗ code route dễ sai
 * mà test với DB giả sơ sài sẽ không phát hiện:
 *  - `select` thật sự lọc trường (route quên `select` một trường thì ở đây cũng thiếu như thật);
 *  - trả về BẢN SAO, sửa kết quả không làm đổi dữ liệu đã lưu;
 *  - `Bytes` trả về Uint8Array chứ không phải Buffer (như Prisma 6);
 *  - mã lỗi P2002 (trùng unique), P2025 (không thấy dòng để update), P2003 (khóa ngoại);
 *  - xóa note kéo theo xóa share (onDelete: Cascade);
 *  - `$transaction` có rollback khi callback ném lỗi.
 *
 * Độ trung thực này được kiểm chứng bằng cách chạy CÙNG một bộ test trên cả DB giả lẫn PostgreSQL
 * thật (xem helpers/backends.js).
 */

/** Cột `updatedAt` của Prisma (@updatedAt) và các cột @default(now()). */
const now = () => new Date();

function prismaError(code, message) {
  return Object.assign(new Error(message), { code });
}

function isBytes(value) {
  return value instanceof Uint8Array;
}

function valuesEqual(a, b) {
  if (isBytes(a) && isBytes(b)) return Buffer.from(a).equals(Buffer.from(b));
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function isOperatorObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !isBytes(value) &&
    !(value instanceof Date) &&
    ('not' in value || 'in' in value || 'notIn' in value)
  );
}

/** Chuyển khóa unique ghép của Prisma (`noteId_recipientId: {...}`) thành các điều kiện phẳng. */
function flatten(where) {
  const flat = {};
  for (const [key, value] of Object.entries(where)) {
    if (key === 'noteId_recipientId') Object.assign(flat, value);
    else flat[key] = value;
  }
  return flat;
}

function matches(row, where) {
  return Object.entries(flatten(where)).every(([key, condition]) => {
    if (!isOperatorObject(condition)) return valuesEqual(row[key], condition);
    if ('not' in condition && valuesEqual(row[key], condition.not)) return false;
    if ('in' in condition && !condition.in.some((v) => valuesEqual(row[key], v))) return false;
    if ('notIn' in condition && condition.notIn.some((v) => valuesEqual(row[key], v))) return false;
    return true;
  });
}

const clone = (value) => structuredClone(value);

export function createFakeDb() {
  const users = new Map(); // email -> dòng User
  const sessions = new Map(); // id -> dòng Session
  const notes = new Map(); // id -> dòng Note
  const shares = new Map(); // id -> dòng Share
  const loginRecords = []; // các dòng LoginHistory, để test soi vào

  /** Áp `select` của Prisma lên một dòng, gồm cả quan hệ `sender`. */
  function project(row, select) {
    if (row === null || row === undefined) return null;
    if (!select) return clone(row);
    const out = {};
    for (const [key, spec] of Object.entries(select)) {
      if (spec === true) out[key] = row[key];
      else if (key === 'sender' || key === 'recipient') {
        const userId = key === 'sender' ? row.senderId : row.recipientId;
        const related = [...users.values()].find((u) => u.id === userId);
        out[key] = project(related, spec.select);
      }
    }
    return clone(out);
  }

  const rowsOf = (map, where = {}) => [...map.values()].filter((row) => matches(row, where));

  function orderRows(rows, orderBy) {
    if (!orderBy) return rows;
    const [[field, direction]] = Object.entries(orderBy);
    const sign = direction === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => sign * (a[field].getTime() - b[field].getTime()));
  }

  function deleteMany(map, where, onDelete) {
    let count = 0;
    for (const [key, row] of [...map.entries()]) {
      if (!matches(row, where)) continue;
      map.delete(key);
      onDelete?.(row);
      count += 1;
    }
    return { count };
  }

  const db = {
    users,
    sessions,
    loginRecords,

    user: {
      async create({ data }) {
        if (users.has(data.email)) throw prismaError('P2002', 'Unique constraint failed');
        const row = { id: crypto.randomUUID(), createdAt: now(), ...data };
        users.set(row.email, row);
        return { id: row.id };
      },
      async findUnique({ where, select }) {
        return project(rowsOf(users, where)[0], select);
      },
      async findMany({ where, select }) {
        return rowsOf(users, where).map((row) => project(row, select));
      },
      async updateMany({ where, data }) {
        const rows = rowsOf(users, where);
        for (const row of rows) Object.assign(row, data);
        return { count: rows.length };
      },
    },

    session: {
      async create({ data }) {
        const at = now();
        const row = { createdAt: at, lastSeenAt: at, userAgent: null, ip: null, ...data };
        sessions.set(row.id, row);
        return clone(row);
      },
      async findUnique({ where, select }) {
        return project(sessions.get(where.id), select);
      },
      async updateMany({ where, data }) {
        const rows = rowsOf(sessions, where);
        for (const row of rows) Object.assign(row, data);
        return { count: rows.length };
      },
      async deleteMany({ where }) {
        return deleteMany(sessions, where);
      },
    },

    loginHistory: {
      async create({ data }) {
        const row = { id: crypto.randomUUID(), createdAt: now(), ...data };
        loginRecords.push(row);
        return clone(row);
      },
    },

    note: {
      async create({ data, select }) {
        if (notes.has(data.id)) throw prismaError('P2002', 'Unique constraint failed');
        const at = now();
        const row = { createdAt: at, updatedAt: at, ...data };
        notes.set(row.id, row);
        return project(row, select);
      },
      async findUnique({ where, select }) {
        return project(rowsOf(notes, where)[0], select);
      },
      async findFirst({ where, select }) {
        return project(rowsOf(notes, where)[0], select);
      },
      async findMany({ where, orderBy, select }) {
        return orderRows(rowsOf(notes, where), orderBy).map((row) => project(row, select));
      },
      // `where` mở rộng (id + ownerId + version) như extendedWhereUnique của Prisma: một câu lệnh
      // vừa kiểm tra điều kiện vừa ghi, không có khe hở giữa "kiểm tra" và "ghi".
      async update({ where, data, select }) {
        const row = rowsOf(notes, where)[0];
        if (!row) throw prismaError('P2025', 'Record to update not found');
        Object.assign(row, data, { updatedAt: now() });
        return project(row, select);
      },
      async deleteMany({ where }) {
        return deleteMany(notes, where, (row) => {
          // onDelete: Cascade từ Note sang Share.
          deleteMany(shares, { noteId: row.id });
        });
      },
    },

    share: {
      async findUnique({ where, select }) {
        return project(rowsOf(shares, where)[0], select);
      },
      async findMany({ where, orderBy, select }) {
        return orderRows(rowsOf(shares, where), orderBy).map((row) => project(row, select));
      },
      async upsert({ where, create, update, select }) {
        const existing = rowsOf(shares, where)[0];
        if (existing) {
          Object.assign(existing, update);
          return project(existing, select);
        }
        if (!notes.has(create.noteId)) throw prismaError('P2003', 'Foreign key constraint failed');
        const row = { id: crypto.randomUUID(), createdAt: now(), ...create };
        shares.set(row.id, row);
        return project(row, select);
      },
      async deleteMany({ where }) {
        return deleteMany(shares, where);
      },
    },

    /**
     * Callback ném lỗi thì mọi thay đổi trong transaction bị hủy, như Prisma thật.
     *
     * Các transaction chạy TUẦN TỰ. Nếu để chồng lên nhau thì bản rollback của transaction thất bại
     * sẽ ghi đè luôn thay đổi đã commit của transaction thành công chạy song song với nó. PostgreSQL
     * thật không bị vậy nhờ khóa dòng, nên ở đây phải mô phỏng cho đúng.
     */
    $transaction(callback) {
      const run = transactionQueue.then(() => runTransaction(callback));
      transactionQueue = run.catch(() => {});
      return run;
    },
  };

  let transactionQueue = Promise.resolve();

  async function runTransaction(callback) {
    const snapshot = {
      users: clone([...users]),
      sessions: clone([...sessions]),
      notes: clone([...notes]),
      shares: clone([...shares]),
    };
    try {
      return await callback(db);
    } catch (err) {
      for (const [map, entries] of [
        [users, snapshot.users],
        [sessions, snapshot.sessions],
        [notes, snapshot.notes],
        [shares, snapshot.shares],
      ]) {
        map.clear();
        for (const [key, row] of entries) map.set(key, row);
      }
      throw err;
    }
  }

  return db;
}
