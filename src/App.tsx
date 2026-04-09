import "./App.css";
import { DownloaderPanel } from "./components/DownloaderPanel";
import { LoginModule } from "./components/LoginModule";
import { PaymentsModule } from "./components/PaymentsModule";
import { useAuth } from "./context/AuthContext";

function App() {
  const { user, loading, token, logout, refreshUser } = useAuth();

  if (loading) {
    return (
      <div className="app-shell">
        <p className="loading-msg">Loading…</p>
      </div>
    );
  }

  if (!token || !user) {
    return <LoginModule />;
  }

  const credits = user.publishingCredits ?? 0;
  if (credits <= 0) {
    return <PaymentsModule onPurchased={() => void refreshUser()} />;
  }

  return (
    <div className="app-shell">
      <header className="app-top-bar">
        <span className="app-top-email">{user.email}</span>
        <button type="button" className="linkish" onClick={() => logout()}>
          Sign out
        </button>
      </header>
      <DownloaderPanel
        email={user.email}
        publishingCredits={user.publishingCredits ?? 0}
      />
    </div>
  );
}

export default App;
