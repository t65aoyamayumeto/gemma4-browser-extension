import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import "./index.css";

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;

  if (url.includes("huggingface.co")) {
    const token = import.meta.env.VITE_HF_TOKEN;
    if (token) {
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${token}`);

      init = {
        ...init,
        headers,
      };
    }
  }

  return originalFetch(input, init);
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
