import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { seedSamplePlayers } from './utils/seedPlayers';

seedSamplePlayers();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
