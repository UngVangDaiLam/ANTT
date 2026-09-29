import { useState, useEffect } from 'react';
import { client } from './client.js';
import { ShareDialog } from './ShareDialog.jsx';

export function NoteEditor({ noteId, isShared, onNoteUpdated, onNoteDeleted }) {
  const [note, setNote] = useState(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState('');
  const [showShareDialog, setShowShareDialog] = useState(false);

  useEffect(() => {
    let active = true;

    const fetchNote = async () => {
      if (!noteId) return;
      setLoading(true);
      setError(null);
      setSuccessMsg('');
      try {
        const fetchedNote = await client.readNote(noteId);
        if (active) {
          setNote(fetchedNote);
          setTitle(fetchedNote.title);
          setContent(fetchedNote.content);
        }
      } catch (err) {
        console.error(err);
        if (active) setError(err.message || 'Không thể tải nội dung ghi chú');
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchNote();
    return () => {
      active = false;
    };
  }, [noteId]);

  const handleSave = async () => {
    if (!note || isShared) return;
    setSaving(true);
    setError(null);
    setSuccessMsg('');
    try {
      await client.updateNote(noteId, { title, content, version: note.version });
      setSuccessMsg('Đã lưu thành công!');
      // Update local note version after save (or re-fetch)
      const fetchedNote = await client.readNote(noteId);
      setNote(fetchedNote);
      onNoteUpdated();
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Lỗi khi lưu ghi chú');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (isShared) return;
    if (!window.confirm('Bạn có chắc muốn xóa ghi chú này?')) return;

    setSaving(true);
    try {
      await client.deleteNote(noteId);
      onNoteDeleted();
    } catch (err) {
      console.error(err);
      setError(err.message || 'Lỗi khi xóa ghi chú');
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div
        className="glass-panel"
        style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}
      >
        <span className="loader"></span>
      </div>
    );
  }

  if (!note) {
    return null;
  }

  return (
    <div
      className="glass-panel"
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1.5rem',
        }}
      >
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Tiêu đề"
          style={{
            fontSize: '1.5rem',
            fontWeight: 600,
            background: 'transparent',
            border: 'none',
            padding: 0,
            outline: 'none',
            flex: 1,
          }}
          disabled={isShared}
        />

        {!isShared && (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-secondary" onClick={() => setShowShareDialog(true)}>
              Chia sẻ
            </button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving || isShared}>
              {saving ? <span className="loader" style={{ width: 14, height: 14 }}></span> : 'Lưu'}
            </button>
            <button className="btn btn-danger" onClick={handleDelete} disabled={saving}>
              Xóa
            </button>
          </div>
        )}
      </div>

      {isShared && (
        <div style={{ marginBottom: '1rem', fontSize: '0.875rem', color: 'var(--accent-primary)' }}>
          Ghi chú này được chia sẻ bởi: {note.sharedBy} (Chỉ xem)
        </div>
      )}

      {error && <div className="error-message">{error}</div>}
      {successMsg && <div className="success-message">{successMsg}</div>}

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Nội dung ghi chú..."
        style={{ flex: 1, marginTop: '1rem', background: 'rgba(0,0,0,0.2)', border: 'none' }}
        disabled={isShared}
      />

      <div
        style={{
          marginTop: '1rem',
          fontSize: '0.75rem',
          color: 'var(--text-secondary)',
          textAlign: 'right',
        }}
      >
        Cập nhật lần cuối: {new Date(note.updatedAt).toLocaleString()}
      </div>

      {showShareDialog && <ShareDialog noteId={noteId} onClose={() => setShowShareDialog(false)} />}
    </div>
  );
}
