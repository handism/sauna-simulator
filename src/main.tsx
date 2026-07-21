import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { SaunaProvider } from "./context/SaunaContext";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SaunaProvider>
      <App />
    </SaunaProvider>
  </StrictMode>,
);
