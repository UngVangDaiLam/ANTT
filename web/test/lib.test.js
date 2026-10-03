import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { describeError } from '../src/lib/errors.js';
import { createIdleTimer } from '../src/lib/idleTimer.js';
import { describeDevice, formatDateTime } from '../src/lib/format.js';
import { parseTheme, resolveTheme } from '../src/lib/theme.js';

describe('describeError', () => {
  test('lỗi do dữ liệu từ máy chủ bị can thiệp được đánh dấu là cảnh báo bảo mật', () => {
    for (const code of ['INTEGRITY_ERROR', 'ROLLBACK_DETECTED']) {
      expect(describeError({ code, message: 'chi tiết nội bộ' })).toMatchObject({
        tone: 'security',
      });
    }
  });

  test('hết phiên được phân loại riêng để giao diện đưa về màn hình đăng nhập', () => {
    expect(describeError({ code: 'UNAUTHENTICATED' }).tone).toBe('session');
  });

  test('không bao giờ đưa thông điệp nội bộ ra màn hình', () => {
    const internal = 'Chu ky khong hop le: goi tin (stack...)';
    for (const code of ['INTEGRITY_ERROR', 'NOT_FOUND', 'INTERNAL_ERROR', 'KHONG_BIET']) {
      expect(describeError({ code, message: internal }).message).not.toContain('Chu ky');
    }
    expect(describeError(new Error(internal)).message).not.toContain('Chu ky');
  });

  test('mật khẩu yếu giữ nguyên lời nhắn cụ thể của SDK', () => {
    const err = { code: 'WEAK_PASSWORD', message: 'Mật khẩu phải có ít nhất 8 ký tự.' };
    expect(describeError(err)).toEqual({ tone: 'error', message: err.message });
  });

  test('mất mạng được báo rõ là lỗi kết nối', () => {
    expect(describeError(new TypeError('Failed to fetch')).message).toContain('kết nối');
  });

  test('lỗi lạ, null hay undefined vẫn ra một lời nhắn chung, không làm sập giao diện', () => {
    for (const err of [null, undefined, 42, 'x', {}]) {
      expect(describeError(err)).toEqual({ tone: 'error', message: expect.any(String) });
    }
  });

  test('mã lỗi trùng tên thuộc tính có sẵn của object không lọt ra thành hàm', () => {
    for (const code of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(describeError({ code })).toEqual({
        tone: 'error',
        message: 'Đã có lỗi xảy ra. Vui lòng thử lại.',
      });
    }
  });
});

describe('createIdleTimer', () => {
  let t;
  beforeEach(() => {
    vi.useFakeTimers();
    t = 0;
  });
  afterEach(() => vi.useRealTimers());

  function setup() {
    const calls = [];
    const timer = createIdleTimer({
      timeoutMs: 1000,
      warnBeforeMs: 200,
      now: () => t,
      onWarn: () => calls.push('warn'),
      onActive: () => calls.push('active'),
      onLock: () => calls.push('lock'),
    });
    const advance = (ms) => {
      t += ms;
      vi.advanceTimersByTime(ms);
    };
    return { timer, calls, advance };
  }

  test('không thao tác: cảnh báo trước rồi mới khóa, khóa đúng một lần', () => {
    const { timer, calls, advance } = setup();
    timer.start();
    advance(799);
    expect(calls).toEqual([]);
    advance(1);
    expect(calls).toEqual(['warn']);
    advance(200);
    expect(calls).toEqual(['warn', 'lock']);
    advance(5000);
    expect(calls).toEqual(['warn', 'lock']);
  });

  test('có thao tác thì đếm lại từ đầu', () => {
    const { timer, calls, advance } = setup();
    timer.start();
    advance(700);
    timer.activity(); // đếm lại từ mốc 700: cảnh báo lúc 1500, khóa lúc 1700
    advance(700);
    expect(calls).toEqual([]);
    advance(200);
    expect(calls).toEqual(['warn']);
    advance(200);
    expect(calls).toEqual(['warn', 'lock']);
  });

  test('thao tác trong lúc đang cảnh báo thì ẩn cảnh báo và không khóa', () => {
    const { timer, calls, advance } = setup();
    timer.start();
    advance(850);
    timer.activity();
    advance(500);
    expect(calls).toEqual(['warn', 'active']);
  });

  test('máy ngủ làm bộ hẹn giờ bị hoãn: kiểm tra lại đồng hồ vẫn khóa đúng hạn', () => {
    const { timer, calls } = setup();
    timer.start();
    t += 5000; // đồng hồ đã trôi, nhưng bộ hẹn giờ chưa kịp chạy
    timer.checkElapsed();
    expect(calls).toEqual(['lock']);
  });

  test('chưa tới hạn thì kiểm tra lại đồng hồ không khóa', () => {
    const { timer, calls } = setup();
    timer.start();
    t += 500;
    timer.checkElapsed();
    expect(calls).toEqual([]);
  });

  test('đã dừng (ví dụ đăng xuất) thì không còn khóa hay cảnh báo', () => {
    const { timer, calls, advance } = setup();
    timer.start();
    timer.stop();
    advance(5000);
    timer.activity();
    timer.checkElapsed();
    expect(calls).toEqual([]);
  });
});

describe('describeDevice', () => {
  const UA = {
    chromeWin:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    edgeWin:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
    safariIphone:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    chromeAndroid:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
    firefoxMac:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:130.0) Gecko/20100101 Firefox/130.0',
  };

  test('nhận ra trình duyệt và hệ điều hành phổ biến, kể cả Edge giả dạng Chrome', () => {
    expect(describeDevice(UA.chromeWin)).toBe('Chrome trên Windows');
    expect(describeDevice(UA.edgeWin)).toBe('Edge trên Windows');
    expect(describeDevice(UA.safariIphone)).toBe('Safari trên iOS');
    expect(describeDevice(UA.chromeAndroid)).toBe('Chrome trên Android');
    expect(describeDevice(UA.firefoxMac)).toBe('Firefox trên macOS');
  });

  test('không có hoặc không nhận ra thì vẫn ra một tên, không ném lỗi', () => {
    expect(describeDevice(null)).toBe('Thiết bị không rõ');
    expect(describeDevice('')).toBe('Thiết bị không rõ');
    expect(describeDevice('curl/8.5.0')).toBe('Trình duyệt không rõ');
  });
});

describe('formatDateTime', () => {
  const now = new Date(2026, 8, 30, 15, 0);

  test('hôm nay và hôm qua giống formatWhen; ngày cũ hơn thì kèm giờ', () => {
    expect(formatDateTime(new Date(2026, 8, 30, 9, 5).toISOString(), now)).toBe('Hôm nay, 09:05');
    expect(formatDateTime(new Date(2026, 8, 29, 9, 5).toISOString(), now)).toBe('Hôm qua, 09:05');
    expect(formatDateTime(new Date(2026, 8, 20, 14, 5).toISOString(), now)).toBe(
      '20/09/2026, 14:05',
    );
  });

  test('chuỗi thời gian hỏng thì trả rỗng', () => {
    expect(formatDateTime('khong-phai-ngay', now)).toBe('');
  });
});

describe('resolveTheme', () => {
  test('lựa chọn đã lưu thắng chế độ của hệ điều hành', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  test('chưa chọn thì theo hệ điều hành', () => {
    expect(resolveTheme(null, true)).toBe('dark');
    expect(resolveTheme(null, false)).toBe('light');
  });

  test('giá trị rác trong localStorage bị bỏ qua, không đưa vào trang', () => {
    for (const junk of ['DARK', 'dark;', '"><script>', '', 1, {}, undefined]) {
      expect(parseTheme(junk)).toBeNull();
      expect(resolveTheme(junk, false)).toBe('light');
    }
  });
});
