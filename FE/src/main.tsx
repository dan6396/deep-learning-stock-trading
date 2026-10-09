import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AppProviders } from "./app/providers";
import App from "./App";
// Self-hosted Pretendard; the dynamic subset only downloads the glyph ranges a page uses.
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
// Layered entry: legacy global.css sits in the lowest layer so Tailwind utilities
// used by the new screens always win, without a preflight reset touching old pages.
import "./styles/index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders>
        <App />
      </AppProviders>
    </BrowserRouter>
  </React.StrictMode>,
);
