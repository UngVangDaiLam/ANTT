import { useState } from 'react';
import { client } from './client.js';

export function ShareDialog({ noteId, onClose }) {
  const [step, setStep] = useState(1); // 1: input email, 2: verify fingerprint
  const [email, setEmail] = useState('');
  const [fingerprint, setFingerprint] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const handleLookup = async (e) => {
    e.preventDefault();
    if (!email) return;

    setLoading(true);
    setError(null);
    try {
      const fp = await client.getFingerprint(email);
      setFingerprint(fp);
      setStep(2);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Không tìm thấy người dùng này');
    } finally {
      setLoading(false);
    }
  };

  const handleShare = async () => {
    setLoading(true);
    setError(null);
    try {
      await client.shareNote(noteId, email);
      setSuccess(true);
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Lỗi khi chia sẻ ghi chú');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal glass-panel">
        <h2 style={{ marginBottom: '1.5rem' }}>Chia sẻ ghi chú</h2>

        {success ? (
          <div style={{ textAlign: 'center', padding: '2rem 0' }}>
            <div style={{ color: 'var(--success)', fontSize: '3rem', marginBottom: '1rem' }}>✓</div>
            <h3>Chia sẻ thành công!</h3>
            <p>Ghi chú đã được chia sẻ an toàn với {email}</p>
          </div>
        ) : (
          <>
            {step === 1 && (
              <form onSubmit={handleLookup}>
                <p style={{ marginBottom: '1rem' }}>
                  Nhập email của người bạn muốn chia sẻ ghi chú này.
                </p>
                <div className="form-group">
                  <label>Email người nhận</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="nguoinhan@example.com"
                    required
                  />
                </div>
                {error && <div className="error-message">{error}</div>}

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: '0.5rem',
                    marginTop: '2rem',
                  }}
                >
                  <button type="button" className="btn btn-secondary" onClick={onClose}>
                    Hủy
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={loading || !email}>
                    {loading ? 'Đang tìm...' : 'Tiếp tục'}
                  </button>
                </div>
              </form>
            )}

            {step === 2 && fingerprint && (
              <div>
                <p style={{ marginBottom: '1rem' }}>
                  Để đảm bảo an toàn và tránh bị đánh tráo khóa (Man-in-the-Middle), vui lòng đối
                  chiếu mã xác nhận (fingerprint) dưới đây với <strong>{email}</strong> qua một kênh
                  khác (điện thoại, tin nhắn riêng).
                </p>

                <div style={{ marginBottom: '1rem' }}>
                  <label>Mã xác nhận Ed25519 (Dùng để xác thực chữ ký):</label>
                  <div className="fingerprint-box">{fingerprint.ed25519Fingerprint}</div>

                  <label>Mã xác nhận X25519 (Dùng để mã hóa khóa):</label>
                  <div className="fingerprint-box">{fingerprint.x25519Fingerprint}</div>
                </div>

                <div
                  className="form-group"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    marginTop: '1rem',
                  }}
                >
                  <input type="checkbox" id="verify-cb" required />
                  <label htmlFor="verify-cb" style={{ color: 'var(--text-primary)' }}>
                    Tôi đã đối chiếu thủ công và xác nhận đây đúng là mã của người nhận.
                  </label>
                </div>

                {error && <div className="error-message">{error}</div>}

                <div
                  style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2rem' }}
                >
                  <button type="button" className="btn btn-secondary" onClick={() => setStep(1)}>
                    Quay lại
                  </button>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button type="button" className="btn btn-secondary" onClick={onClose}>
                      Hủy
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleShare}
                      disabled={loading}
                    >
                      {loading ? 'Đang chia sẻ...' : 'Xác nhận chia sẻ'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
