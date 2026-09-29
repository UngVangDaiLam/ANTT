import { useState, useEffect, useCallback } from 'react';
import { client } from './client.js';
import { NoteEditor } from './NoteEditor.jsx';

export function Dashboard({ onLogout }) {
  const [notes, setNotes] = useState([]);
  const [sharedNotes, setSharedNotes] = useState([]);
  const [selectedNoteId, setSelectedNoteId] = useState(null);
  const [loadingList, setLoadingList] = useState(false);
  const [error, setError] = useState(null);

  const userEmail = client.currentUserEmail();

  const fetchNotes = useCallback(async () => {
    setLoadingList(true);
    setError(null);
    try {
      const myNotes = await client.listNotes();
      setNotes(myNotes);
      const mySharedNotes = await client.listSharedWithMe();
      setSharedNotes(mySharedNotes);
    } catch (err) {
      console.error(err);
      if (err.code === 'UNAUTHENTICATED') {
        onLogout();
      } else {
        setError(err.message || 'Không thể tải danh sách ghi chú');
      }
    } finally {
      setLoadingList(false);
    }
  }, [onLogout]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const handleLogout = async () => {
    try {
      await client.logout();
    } catch (e) {
      console.error(e);
    }
    onLogout();
  };

  const handleCreateNew = async () => {
    try {
      const newNote = await client.createNote({ title: 'Ghi chú mới', content: '' });
      await fetchNotes();
      setSelectedNoteId(newNote.id);
    } catch (err) {
      console.error(err);
      setError(err.message);
    }
  };

  const isSharedNote = sharedNotes.some((n) => n.noteId === selectedNoteId);

  return (
    <div className="dashboard">
      <aside className="sidebar glass-panel">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1rem',
          }}
        >
          <h2>Ghi chú</h2>
          <button
            className="btn btn-primary"
            onClick={handleCreateNew}
            style={{ padding: '0.5rem 1rem' }}
          >
            + Tạo mới
          </button>
        </div>

        {loadingList ? (
          <div style={{ textAlign: 'center', padding: '1rem' }}>
            <span className="loader"></span>
          </div>
        ) : (
          <div className="note-list">
            {notes.map((note) => (
              <div
                key={note.id}
                className={`note-item ${selectedNoteId === note.id ? 'active' : ''}`}
                onClick={() => setSelectedNoteId(note.id)}
              >
                <h3>{note.title || 'Không có tiêu đề'}</h3>
                <p>Cập nhật: {new Date(note.updatedAt).toLocaleDateString()}</p>
              </div>
            ))}

            {sharedNotes.length > 0 && (
              <>
                <h3 style={{ fontSize: '1rem', marginTop: '1rem', marginBottom: '0.5rem' }}>
                  Được chia sẻ với tôi
                </h3>
                {sharedNotes.map((share) => (
                  <div
                    key={share.id}
                    className={`note-item ${selectedNoteId === share.noteId ? 'active' : ''}`}
                    onClick={() => setSelectedNoteId(share.noteId)}
                  >
                    <h3>Ghi chú chia sẻ</h3>
                    <p>Từ: {share.senderEmail}</p>
                  </div>
                ))}
              </>
            )}

            {notes.length === 0 && sharedNotes.length === 0 && (
              <p style={{ textAlign: 'center', padding: '1rem' }}>Chưa có ghi chú nào.</p>
            )}
          </div>
        )}
      </aside>

      <main className="main-content">
        <div className="top-nav">
          <div>
            <h1 style={{ fontSize: '1.5rem', marginBottom: 0 }}>Secure Notes</h1>
          </div>
          <div className="user-info">
            <span style={{ fontSize: '0.875rem' }}>{userEmail}</span>
            <button
              className="btn btn-secondary"
              onClick={handleLogout}
              style={{ padding: '0.5rem 1rem' }}
            >
              Đăng xuất
            </button>
          </div>
        </div>

        {error && <div className="error-message">{error}</div>}

        {selectedNoteId ? (
          <NoteEditor
            noteId={selectedNoteId}
            isShared={isSharedNote}
            onNoteUpdated={fetchNotes}
            onNoteDeleted={() => {
              setSelectedNoteId(null);
              fetchNotes();
            }}
          />
        ) : (
          <div
            className="glass-panel"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              minHeight: '400px',
            }}
          >
            <p>Chọn một ghi chú để xem hoặc tạo mới</p>
          </div>
        )}
      </main>
    </div>
  );
}
