/**
 * Ranh giới kiến trúc, kiểm tra tự động trong CI (pnpm depcheck).
 * Đây là bằng chứng cho nguyên tắc "máy chủ không tin cậy":
 * server không thể gọi bất kỳ hàm mật mã phía client nào.
 */
module.exports = {
  forbidden: [
    {
      name: 'server-khong-dung-crypto',
      severity: 'error',
      comment: 'server/ không được import crypto/, client-sdk/ hay libsodium.',
      from: { path: '^server/' },
      to: { path: ['^crypto/', '^client-sdk/', '@secure-notes/(crypto|client-sdk)', 'libsodium'] },
    },
    {
      name: 'web-chi-goi-sdk',
      severity: 'error',
      comment: 'web/ chỉ gọi client-sdk/, không gọi crypto/ hay libsodium trực tiếp.',
      from: { path: '^web/' },
      to: { path: ['^crypto/', '^server/', '@secure-notes/(crypto|server)', 'libsodium'] },
    },
    {
      name: 'crypto-thuan',
      severity: 'error',
      comment: 'crypto/ không biết gì về mạng, server hay giao diện.',
      from: { path: '^crypto/' },
      to: {
        path: ['^client-sdk/', '^server/', '^web/', '@secure-notes/(client-sdk|server|web)'],
      },
    },
    {
      name: 'shared-khong-phu-thuoc',
      severity: 'error',
      comment: 'shared/ chỉ chứa schema, hằng số, mã lỗi; không phụ thuộc gói nào khác của dự án.',
      from: { path: '^shared/' },
      to: {
        path: [
          '^crypto/',
          '^client-sdk/',
          '^server/',
          '^web/',
          '@secure-notes/(crypto|client-sdk|server|web)',
          'libsodium',
        ],
      },
    },
    {
      name: 'client-sdk-khong-goi-server',
      severity: 'error',
      from: { path: '^client-sdk/' },
      to: { path: ['^server/', '^web/', '@secure-notes/(server|web)'] },
    },
    {
      name: 'khong-ai-dung-integration',
      severity: 'error',
      comment:
        'integration/ chỉ chứa test tích hợp, là nơi DUY NHẤT được dùng cả client-sdk lẫn server. ' +
        'Không package nào được import ngược vào nó.',
      from: { pathNot: '^integration/' },
      to: { path: ['^integration/', '@secure-notes/integration'] },
    },
    {
      name: 'goi-phai-khai-bao',
      severity: 'error',
      comment:
        'Chỉ import gói đã khai báo trong package.json của chính thư mục đó ' +
        '(chặn việc lách ranh giới bằng cách import gói không khai báo).',
      from: {},
      to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
    },
    {
      name: 'import-phai-giai-duoc',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'khong-vong-lap',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(node_modules|dist|coverage)' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'node', 'default'],
      extensions: ['.js', '.jsx', '.mjs'],
    },
  },
};
