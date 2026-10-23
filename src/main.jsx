import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './install.js';
import App from './App.jsx';
import { applySkin } from './skin.js';
import './styles.css';

applySkin(); // 첫 화면 전에 스킨 적용 (깜빡임 방지)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
