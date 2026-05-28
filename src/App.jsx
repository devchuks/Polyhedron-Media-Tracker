import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppLayout } from './components/Layout';
import { Dashboard, MediaCategory, DetailView } from './pages/Pages';
import Settings from './pages/Settings';
import { Diary } from './pages/Diary';
import { ImportTerminal } from './pages/ImportTerminal';
import { NotFound } from './pages/NotFound';
import { Discovery } from './pages/Discovery';
import { Explore } from './pages/Explore';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="discovery" element={<Discovery />} />
          <Route path="diary" element={<Diary />} />
          <Route path="import" element={<ImportTerminal />} />
          <Route path="settings" element={<Settings />} />
          <Route path=":category" element={<MediaCategory />} />
          <Route path="media/:type/:id" element={<DetailView />} />
          <Route path="explore/:api/:type/:id" element={<Explore />} />
          {/* Fallback 404 Route */}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;