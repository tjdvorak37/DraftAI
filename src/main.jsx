import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import './workspace.css';
import './access.css';
import './operations.css';
import './editor.css';
import './supply.css';

createRoot(document.getElementById('root')).render(<App />);