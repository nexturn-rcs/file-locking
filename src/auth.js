// src/auth.js

export const login = () => {
  const domain = process.env.REACT_APP_COGNITO_DOMAIN;
  const clientId = process.env.REACT_APP_CLIENT_ID;
  const redirectUri = process.env.REACT_APP_REDIRECT_URI;

  const loginUrl = `https://${domain}/login?client_id=${clientId}&response_type=token&scope=email+openid+profile&redirect_uri=${redirectUri}`;
  window.location.href = loginUrl;
};

export const logout = () => {
  const domain = process.env.REACT_APP_COGNITO_DOMAIN;
  const clientId = process.env.REACT_APP_CLIENT_ID;
  const redirectUri = process.env.REACT_APP_REDIRECT_URI;

  // Clear localStorage to remove cached user
  localStorage.removeItem("username");

  const logoutUrl = `https://${domain}/logout?client_id=${clientId}&logout_uri=${redirectUri}`;
  window.location.href = logoutUrl;
};


export const getUserFromToken = () => {
  const hash = window.location.hash.substring(1);
  const params = new URLSearchParams(hash);
  const idToken = params.get("id_token");

  if (idToken) {
    const payload = JSON.parse(atob(idToken.split(".")[1]));
    const username = payload.email || payload["cognito:username"];
    localStorage.setItem("username", username);
    return payload;
  }

  const storedUsername = localStorage.getItem("username");
  return storedUsername ? { email: storedUsername } : null;
};
