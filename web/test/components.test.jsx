// @vitest-environment happy-dom
/**
 * Test component React (D84). `client` (client-sdk thật) được thay bằng bản giả điều khiển được, để
 * dựng đúng những tình huống khó tạo bằng tay: máy chủ báo xung đột, sai mật khẩu, người khác lưu
 * xen giữa lúc thu hồi quyền... Luồng đầy đủ với máy chủ thật do web/e2e/ui-check.mjs kiểm.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '@secure-notes/client-sdk';
import { ToastProvider } from '../src/components/Feedback.jsx';
import { describeError } from '../src/lib/errors.js';

const fakeClient = vi.hoisted(() => ({}));
vi.mock('../src/client.js', () => ({ client: fakeClient }));

const { ShareDialog } = await import('../src/ShareDialog.jsx');
const { SessionsDialog } = await import('../src/SessionsDialog.jsx');
const { NoteEditor } = await import('../src/NoteEditor.jsx');
const { ChangePasswordDialog } = await import('../src/ChangePasswordDialog.jsx');
const { ThemeToggle } = await import('../src/components/ThemeToggle.jsx');

const renderUi = (ui) => render(<ToastProvider>{ui}</ToastProvider>);
const onError = (err) => describeError(err);
const typeInto = (element, value) => fireEvent.change(element, { target: { value } });

beforeEach(() => {
  for (const key of Object.keys(fakeClient)) delete fakeClient[key];
  fakeClient.currentUserEmail = () => 'alice@example.com';
});

afterEach(() => cleanup());

// ------------------------------------------------------------------ ShareDialog

describe('ShareDialog: đối chiếu mã trước khi chia sẻ', () => {
  const bobFingerprint = {
    email: 'bob@example.com',
    x25519Fingerprint: 'AAAA BBBB CCCC',
    ed25519Fingerprint: 'DDDD EEEE FFFF',
  };

  beforeEach(() => {
    fakeClient.listNoteShares = vi.fn(async () => []);
    fakeClient.getFingerprint = vi.fn(async () => bobFingerprint);
    fakeClient.shareNote = vi.fn(async () => ({ id: 'share-1' }));
  });

  async function lookUpBob() {
    renderUi(
      <ShareDialog
        noteId="n1"
        noteTitle="Bí mật"
        onClose={() => {}}
        onVersionChange={() => {}}
        onError={onError}
      />,
    );
    typeInto(screen.getByLabelText('Email người nhận'), 'bob@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
    await screen.findByText('AAAA BBBB CCCC');
  }

  test('nút Chia sẻ bị khóa và bấm cũng không chia sẻ cho tới khi tick xác nhận', async () => {
    await lookUpBob();
    const shareButton = screen.getByRole('button', { name: 'Chia sẻ' });

    expect(shareButton.disabled).toBe(true);
    fireEvent.click(shareButton);
    expect(fakeClient.shareNote).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('checkbox'));
    expect(shareButton.disabled).toBe(false);
  });

  test('chia sẻ gửi kèm đúng mã vừa đối chiếu, để SDK từ chối nếu khóa bị tráo (D75)', async () => {
    await lookUpBob();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Chia sẻ' }));

    await waitFor(() => expect(fakeClient.shareNote).toHaveBeenCalledTimes(1));
    expect(fakeClient.shareNote).toHaveBeenCalledWith('n1', 'bob@example.com', {
      verifiedFingerprint: bobFingerprint,
    });
  });

  test('SDK phát hiện khóa bị tráo: hiện cảnh báo bảo mật, không báo thành công', async () => {
    fakeClient.shareNote = vi.fn(async () => {
      throw new ApiError('INTEGRITY_ERROR', 'khóa đổi');
    });
    await lookUpBob();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Chia sẻ' }));

    expect(await screen.findByText(/không hợp lệ hoặc đã bị sửa/)).toBeTruthy();
    expect(screen.queryByText(/Đã chia sẻ an toàn/)).toBeNull();
  });

  test('không cho chia sẻ cho chính mình, không gọi máy chủ', async () => {
    renderUi(
      <ShareDialog
        noteId="n1"
        noteTitle="Bí mật"
        onClose={() => {}}
        onVersionChange={() => {}}
        onError={onError}
      />,
    );
    typeInto(screen.getByLabelText('Email người nhận'), ' Alice@Example.com ');
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));

    expect(await screen.findByText(/chính mình/)).toBeTruthy();
    expect(fakeClient.getFingerprint).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------ SessionsDialog

describe('SessionsDialog: thiết bị, lịch sử, xóa tài khoản', () => {
  let onAccountDeleted;

  const sessions = [
    {
      id: 'b'.repeat(64),
      current: false,
      createdAt: '2026-09-30T07:00:00.000Z',
      lastSeenAt: '2026-09-30T08:00:00.000Z',
      expiresAt: '2026-10-01T07:00:00.000Z',
      ip: '203.0.113.9',
      userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/140.0 Mobile Safari/537.36',
    },
    {
      id: 'a'.repeat(64),
      current: true,
      createdAt: '2026-09-30T06:00:00.000Z',
      lastSeenAt: '2026-09-30T07:30:00.000Z',
      expiresAt: '2026-10-01T06:00:00.000Z',
      ip: '203.0.113.5',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0 Safari/537.36',
    },
  ];

  beforeEach(() => {
    onAccountDeleted = vi.fn();
    fakeClient.listSessions = vi.fn(async () => sessions);
    fakeClient.loginHistory = vi.fn(async () => [
      {
        id: crypto.randomUUID(),
        success: false,
        kind: 'change_password',
        createdAt: '2026-09-30T08:10:00.000Z',
        ip: '198.51.100.7',
        userAgent: null,
      },
      {
        id: crypto.randomUUID(),
        success: true,
        kind: 'login',
        createdAt: '2026-09-30T06:00:00.000Z',
        ip: '203.0.113.5',
        userAgent: null,
      },
    ]);
  });

  const renderDialog = () =>
    renderUi(
      <SessionsDialog
        email="alice@example.com"
        onClose={() => {}}
        onError={onError}
        onChangePassword={() => {}}
        onAccountDeleted={onAccountDeleted}
      />,
    );

  /** Hộp nhập lại mật khẩu nằm TRÊN hộp danh sách; chỉ tìm trong hộp trên cùng. */
  const topDialog = () => within(screen.getAllByRole('dialog').at(-1));

  test('thiết bị hiện tại đứng đầu, có nhãn, và không có nút tự đăng xuất', async () => {
    renderDialog();
    const items = await screen.findAllByRole('listitem');

    expect(within(items[0]).getByText('Thiết bị này')).toBeTruthy();
    expect(within(items[0]).queryByRole('button', { name: 'Đăng xuất' })).toBeNull();
    expect(within(items[1]).getByText('Chrome trên Android')).toBeTruthy();
    expect(within(items[1]).getByRole('button', { name: 'Đăng xuất' })).toBeTruthy();
  });

  test('đăng xuất thiết bị khác phải nhập lại mật khẩu; sai thì báo, không đóng hộp', async () => {
    fakeClient.revokeSessions = vi.fn(async () => {
      throw new ApiError('INVALID_CREDENTIALS', 'sai');
    });
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Đăng xuất' }));

    const confirm = topDialog().getByRole('button', { name: 'Đăng xuất' });
    expect(confirm.disabled).toBe(true); // chưa nhập mật khẩu
    typeInto(topDialog().getByLabelText('Mật khẩu hiện tại'), 'mat-khau-sai');
    fireEvent.click(confirm);

    expect(await screen.findByText('Mật khẩu không đúng.')).toBeTruthy();
    expect(fakeClient.revokeSessions).toHaveBeenCalledWith('mat-khau-sai', 'b'.repeat(64));
    expect(screen.getByText('Xác nhận bằng mật khẩu')).toBeTruthy();
  });

  test('đúng mật khẩu: đóng hộp, báo thành công, tải lại danh sách', async () => {
    fakeClient.revokeSessions = vi.fn(async () => ({ revoked: 1 }));
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Đăng xuất' }));
    typeInto(topDialog().getByLabelText('Mật khẩu hiện tại'), 'mat-khau-dung');
    fireEvent.click(topDialog().getByRole('button', { name: 'Đăng xuất' }));

    expect(await screen.findByText('Đã đăng xuất thiết bị.')).toBeTruthy();
    expect(screen.queryByText('Xác nhận bằng mật khẩu')).toBeNull();
    expect(fakeClient.listSessions).toHaveBeenCalledTimes(2);
  });

  test('lịch sử: cảnh báo khi có lần sai, ghi rõ loại (đổi mật khẩu)', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('tab', { name: 'Lịch sử' }));

    expect(await screen.findByText('1 lần nhập sai mật khẩu gần đây')).toBeTruthy();
    expect(screen.getByText('Đổi mật khẩu: sai mật khẩu hiện tại')).toBeTruthy();
    expect(screen.getByText('Đăng nhập thành công')).toBeTruthy();
  });

  test('xóa tài khoản: nút chỉ bấm được khi gõ đúng email VÀ có mật khẩu', async () => {
    fakeClient.deleteAccount = vi.fn(async () => {});
    renderDialog();
    fireEvent.click(screen.getByRole('tab', { name: 'Xóa tài khoản' }));
    const button = screen.getByRole('button', { name: 'Xóa vĩnh viễn tài khoản' });
    const emailBox = screen.getByLabelText(/để xác nhận/);

    typeInto(screen.getByLabelText('Mật khẩu hiện tại'), 'mat-khau');
    typeInto(emailBox, 'bob@example.com');
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(fakeClient.deleteAccount).not.toHaveBeenCalled();

    typeInto(emailBox, ' ALICE@example.com ');
    expect(button.disabled).toBe(false);
    fireEvent.click(button);

    await waitFor(() => expect(onAccountDeleted).toHaveBeenCalledTimes(1));
    expect(fakeClient.deleteAccount).toHaveBeenCalledWith('mat-khau');
  });

  test('xóa tài khoản sai mật khẩu: báo rõ, không coi là đã xóa', async () => {
    fakeClient.deleteAccount = vi.fn(async () => {
      throw new ApiError('INVALID_CREDENTIALS', 'sai');
    });
    renderDialog();
    fireEvent.click(screen.getByRole('tab', { name: 'Xóa tài khoản' }));
    typeInto(screen.getByLabelText(/để xác nhận/), 'alice@example.com');
    typeInto(screen.getByLabelText('Mật khẩu hiện tại'), 'sai');
    fireEvent.click(screen.getByRole('button', { name: 'Xóa vĩnh viễn tài khoản' }));

    expect(await screen.findByText('Mật khẩu không đúng.')).toBeTruthy();
    expect(onAccountDeleted).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------ NoteEditor

describe('NoteEditor: không âm thầm ghi đè', () => {
  const note = (version, content = 'Nội dung') => ({
    id: 'n1',
    version,
    title: 'Ghi chú',
    content,
    updatedAt: '2026-09-30T07:00:00.000Z',
    sharedBy: null,
  });

  const renderEditor = () =>
    renderUi(
      <NoteEditor
        noteId="n1"
        focusTitle={false}
        onSaved={() => {}}
        onDeleted={() => {}}
        onDirtyChange={() => {}}
        onError={onError}
      />,
    );

  test('máy chủ báo VERSION_CONFLICT: hiện lựa chọn, chữ của người dùng còn nguyên, khóa nút Lưu', async () => {
    fakeClient.readNote = vi.fn(async () => note(1));
    fakeClient.updateNote = vi.fn(async () => {
      throw new ApiError('VERSION_CONFLICT', 'xung đột');
    });
    renderEditor();
    const content = await screen.findByLabelText('Nội dung ghi chú');
    typeInto(content, 'Bản của tôi');
    fireEvent.click(screen.getByRole('button', { name: /Lưu/ }));

    expect(await screen.findByText('Ghi chú vừa được sửa ở nơi khác')).toBeTruthy();
    expect(content.value).toBe('Bản của tôi');
    expect(screen.getByRole('button', { name: /Lưu/ }).disabled).toBe(true);
    expect(fakeClient.updateNote).toHaveBeenCalledWith('n1', {
      title: 'Ghi chú',
      content: 'Bản của tôi',
      version: 1,
    });
  });

  test('bấm Tải bản mới nhất thì mở bản của máy chủ và bỏ cảnh báo', async () => {
    fakeClient.readNote = vi
      .fn()
      .mockResolvedValueOnce(note(1))
      .mockResolvedValueOnce(note(2, 'Bản từ máy khác'));
    fakeClient.updateNote = vi.fn(async () => {
      throw new ApiError('VERSION_CONFLICT', 'xung đột');
    });
    renderEditor();
    typeInto(await screen.findByLabelText('Nội dung ghi chú'), 'Bản của tôi');
    fireEvent.click(screen.getByRole('button', { name: /Lưu/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Tải bản mới nhất/ }));

    await waitFor(() =>
      expect(screen.getByLabelText('Nội dung ghi chú').value).toBe('Bản từ máy khác'),
    );
    expect(screen.queryByText('Ghi chú vừa được sửa ở nơi khác')).toBeNull();
  });

  /** Mở hộp chia sẻ → tab Người có quyền → thu hồi quyền của Bob. */
  async function revokeBob() {
    fireEvent.click(await screen.findByRole('button', { name: /Chia sẻ/ }));
    fireEvent.click(await screen.findByRole('tab', { name: /Người có quyền/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Thu hồi quyền' }));
    const dialogs = screen.getAllByRole('dialog');
    fireEvent.click(within(dialogs.at(-1)).getByRole('button', { name: 'Thu hồi quyền' }));
    await waitFor(() => expect(fakeClient.revokeAccess).toHaveBeenCalled());
  }

  function withShares() {
    fakeClient.listNoteShares = vi.fn(async () => [
      {
        id: crypto.randomUUID(),
        recipientEmail: 'bob@example.com',
        createdAt: '2026-09-30T07:00:00.000Z',
      },
    ]);
  }

  test('thu hồi quyền nối tiếp đúng bản đang mở: nhận version mới, lần lưu sau dùng version đó', async () => {
    withShares();
    fakeClient.readNote = vi.fn(async () => note(1));
    fakeClient.revokeAccess = vi.fn(async () => ({ version: 2, keptRecipients: [] }));
    fakeClient.updateNote = vi.fn(async () => ({
      id: 'n1',
      version: 3,
      updatedAt: '2026-09-30T08:00:00.000Z',
    }));
    renderEditor();
    await revokeBob();
    fireEvent.keyDown(document, { key: 'Escape' });

    typeInto(screen.getByLabelText('Nội dung ghi chú'), 'Sửa sau khi thu hồi');
    fireEvent.click(screen.getByRole('button', { name: /Lưu/ }));

    await waitFor(() => expect(fakeClient.updateNote).toHaveBeenCalled());
    expect(fakeClient.updateNote.mock.calls[0][1].version).toBe(2);
    expect(fakeClient.readNote).toHaveBeenCalledTimes(1);
  });

  test('có người lưu xen giữa lúc thu hồi (version nhảy cóc): KHÔNG nhận version, tải lại bản mới (D76)', async () => {
    withShares();
    fakeClient.readNote = vi
      .fn()
      .mockResolvedValueOnce(note(1))
      .mockResolvedValueOnce(note(3, 'Bản máy khác lưu xen giữa'));
    // Máy khác lưu v2, thu hồi xoay khóa trên v2 thành v3.
    fakeClient.revokeAccess = vi.fn(async () => ({ version: 3, keptRecipients: [] }));
    renderEditor();
    await revokeBob();

    await waitFor(() => expect(fakeClient.readNote).toHaveBeenCalledTimes(2));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.getByLabelText('Nội dung ghi chú').value).toBe('Bản máy khác lưu xen giữa'),
    );
  });

  test('ghi chú được chia sẻ cho mình: chỉ đọc, không có nút Lưu, Chia sẻ, Xóa', async () => {
    fakeClient.readNote = vi.fn(async () => ({ ...note(1), sharedBy: 'bob@example.com' }));
    renderEditor();

    const content = await screen.findByLabelText('Nội dung ghi chú');
    expect(content.readOnly).toBe(true);
    expect(screen.queryByRole('button', { name: /Lưu/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Chia sẻ/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Xóa ghi chú' })).toBeNull();
    expect(screen.getByText('bob@example.com')).toBeTruthy();
  });

  test('dữ liệu từ máy chủ bị sửa: hiện cảnh báo bảo mật thay vì nội dung', async () => {
    fakeClient.readNote = vi.fn(async () => {
      throw new ApiError('INTEGRITY_ERROR', 'sai tag');
    });
    renderEditor();

    expect(await screen.findByText('Đã chặn dữ liệu không an toàn')).toBeTruthy();
    expect(screen.queryByLabelText('Nội dung ghi chú')).toBeNull();
  });
});

// ------------------------------------------------------------------ ChangePasswordDialog

describe('ChangePasswordDialog', () => {
  const renderDialog = () =>
    renderUi(<ChangePasswordDialog onClose={() => {}} onSessionExpired={() => {}} />);

  const fill = (current, next, confirm = next) => {
    typeInto(screen.getByLabelText('Mật khẩu hiện tại'), current);
    typeInto(screen.getByLabelText('Mật khẩu mới'), next);
    typeInto(screen.getByLabelText('Nhập lại mật khẩu mới'), confirm);
  };
  const submit = () => screen.getByRole('button', { name: 'Đổi mật khẩu' });

  test('mật khẩu mới trùng mật khẩu cũ, quá ngắn, hoặc nhập lại không khớp: nút bị khóa', () => {
    renderDialog();

    fill('mot cau mat khau cu', 'mot cau mat khau cu');
    expect(screen.getByText('Mật khẩu mới phải khác mật khẩu hiện tại.')).toBeTruthy();
    expect(submit().disabled).toBe(true);

    fill('mot cau mat khau cu', 'ngan');
    expect(submit().disabled).toBe(true);

    fill('mot cau mat khau cu', 'mot cau mat khau moi', 'khac han');
    expect(screen.getByText('Hai mật khẩu chưa khớp.')).toBeTruthy();
    expect(submit().disabled).toBe(true);
  });

  test('sai mật khẩu hiện tại: báo rõ, không đóng hộp', async () => {
    fakeClient.changePassword = vi.fn(async () => {
      throw new ApiError('INVALID_CREDENTIALS', 'sai');
    });
    renderDialog();
    fill('mat khau cu bi sai', 'mot cau mat khau moi du dai');
    fireEvent.click(submit());

    expect(await screen.findByText('Mật khẩu hiện tại không đúng.')).toBeTruthy();
    expect(fakeClient.changePassword).toHaveBeenCalledWith(
      'mat khau cu bi sai',
      'mot cau mat khau moi du dai',
    );
  });
});

describe('ThemeToggle', () => {
  afterEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  test('bấm thì đổi chế độ cả trang và ghi nhớ lựa chọn', () => {
    localStorage.setItem('secure-notes:theme', 'light');
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole('button', { name: 'Chuyển sang chế độ tối' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('secure-notes:theme')).toBe('dark');

    fireEvent.click(screen.getByRole('button', { name: 'Chuyển sang chế độ sáng' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('secure-notes:theme')).toBe('light');
  });

  test('giá trị đã lưu bị sửa thành rác thì không làm hỏng trang', () => {
    localStorage.setItem('secure-notes:theme', 'tim-hong');
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: /Chuyển sang chế độ/ })).toBeTruthy();
    expect(localStorage.getItem('secure-notes:theme')).toBe('tim-hong');
  });
});
