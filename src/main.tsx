import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ClientApp } from './features/client/ClientApp';
import { KitchenApp } from './features/kitchen/KitchenApp';
import { DriverApp } from './features/driver/DriverApp';
import './index.css';
import 'leaflet/dist/leaflet.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ClientApp />} />
        <Route path="/cozinha" element={<KitchenApp />} />
        <Route path="/entregador" element={<DriverApp />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
