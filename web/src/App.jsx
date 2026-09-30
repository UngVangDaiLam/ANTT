import { useState, useEffect } from 'react';
import { client } from './client.js';
import { AuthForm } from './AuthForm.jsx';
import { Dashboard } from './Dashboard.jsx';

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    setIsLoggedIn(client.isLoggedIn());
  }, []);

  return (
    <div className="app-container">
      {isLoggedIn ? (
        <Dashboard onLogout={() => setIsLoggedIn(false)} />
      ) : (
        <AuthForm onLogin={() => setIsLoggedIn(true)} />
      )}
    </div>
  );
}
