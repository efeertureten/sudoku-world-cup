import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow/700.css';
import '@fontsource/big-shoulders-display/700';
import '@fontsource/big-shoulders-display/800';
import 'flag-icons/css/flag-icons.min.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useLocale } from './lib/i18n';

document.documentElement.lang = useLocale.getState().locale;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
