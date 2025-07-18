import React, { useEffect, useState } from "react";
import FileList from "./FileList";
import { login, getUserFromToken, logout } from "./auth";

function App() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    const u = getUserFromToken();
    if (u) {
      setUser(u);
    } else {
      login(); // redirect to Cognito login if not logged in
    }
  }, []);

  return (
    <div className="App">
      {user && (
        <>
          <div style={{ textAlign: "right", padding: "10px 20px" }}>
            Logged in as <strong>{user.email}</strong>
            <button onClick={logout} style={{ marginLeft: 10 }}>Logout</button>
          </div>
          <FileList />
        </>
      )}
    </div>
  );
}

export default App;