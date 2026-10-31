import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { applyTheme, loadTheme } from "./app/theme";
import "./app/app.css";

// Apply the saved appearance before the first React paint.
applyTheme(loadTheme());

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
