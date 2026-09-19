/**
 * assertSchema.js
 * ---------------
 * Ham dung chung: kiem tra 1 gia tri (thuong la response JSON tu server) khop
 * voi 1 TypeBox schema, dung Value.Check (khong sinh code, an toan voi CSP -
 * xem schemas.js). Neu sai, nem loi ro rang kem chi tiet dau tien tim thay,
 * thay vi de code phia sau (giai ma, base64...) nem ra loi mo ho kho debug.
 */

import { Value } from '@sinclair/typebox/value';

/**
 * @param {import('@sinclair/typebox').TSchema} schema
 * @param {unknown} value
 * @param {string} contextLabel - vi du "GET /notes/:id" - de bao loi de doc hon.
 * @returns {unknown} chinh value dau vao, khong doi gi, chi de tien goi theo kieu `return assertSchema(...)`.
 */
export function assertSchema(schema, value, contextLabel) {
  if (Value.Check(schema, value)) {
    return value;
  }
  const firstError = Value.Errors(schema, value).First();
  const detail = firstError ? `${firstError.path}: ${firstError.message}` : 'khong ro chi tiet';
  throw new Error(
    `Phan hoi tu server khong dung dinh dang mong doi (${contextLabel}) - ${detail}. ` +
      'Day co the la dau hieu server bi loi hoac bi can thiep, tu choi xu ly tiep de an toan.',
  );
}
