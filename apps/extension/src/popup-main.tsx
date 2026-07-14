import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Popup } from './screens/popup';
import './styles.css';

// Entry for the toolbar quick-actions popup (action.default_popup). Mirrors main.tsx but roots the
// tiny <Popup> launcher instead of the full <App> panel.
const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Popup />
    </StrictMode>,
  );
}
