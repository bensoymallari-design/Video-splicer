import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import Output from "./Output.jsx";
import "./styles.css";

const outputMatch = window.location.pathname.match(/^\/output\/([^/]+)/);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    {outputMatch ? <Output controllerId={outputMatch[1]} /> : <App />}
  </StrictMode>,
);
