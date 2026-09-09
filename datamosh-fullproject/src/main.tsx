import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { createControlPane } from '@/controls';
import { Preloader } from '@/preloader';
import { Scene } from '@/scene/canvas';

const root = document.getElementById('root');
if (root === null) throw new Error('#root is missing from index.html');

// Before React: the panel is built once and owns its values, so there is no
// mount order to reconcile and StrictMode's double mount cannot duplicate it.
// Opt-in only: the page ships clean (it is embedded in the article), and the
// panel appears with ?debug in the URL.
if (new URLSearchParams(location.search).has('debug')) createControlPane();

createRoot(root).render(
  <StrictMode>
    <Preloader />
    <Scene />
  </StrictMode>,
);
