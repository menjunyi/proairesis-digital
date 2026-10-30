import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import AnalyticsChoice from "./AnalyticsChoice.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
    <AnalyticsChoice />
  </React.StrictMode>,
);
