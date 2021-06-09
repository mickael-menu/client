/* global process */

/**
 * @typedef {import('../types/annotator').HypothesisWindow} HypothesisWindow
 */

// Load polyfill for :focus-visible pseudo-class.
import 'focus-visible';

// Enable debug checks for Preact components.
if (process.env.NODE_ENV !== 'production') {
  require('preact/debug');
}

// Load icons.
import { registerIcons } from '@hypothesis/frontend-shared';
import iconSet from './icons';
registerIcons(iconSet);

import { getConfig } from './config/index';
import Guest from './guest';
import Notebook from './notebook';
import { FrameConnector } from './communicator';
import Sidebar from './sidebar';
import { EventBus } from './util/emitter';

const window_ = /** @type {HypothesisWindow} */ (window);

// Look up the URL of the sidebar. This element is added to the page by the
// boot script before the "annotator" bundle loads.
const appLinkEl = /** @type {Element} */ (
  document.querySelector(
    'link[type="application/annotator+html"][rel="sidebar"]'
  )
);

function init() {
  const annotatorConfig = getConfig('annotator');
  const isPDF = typeof window_.PDFViewerApplication !== 'undefined';

  let frameConnector = /** @type {FrameConnector?} */ (null);
  let sidebar = /** @type {Sidebar?} */ (null);
  let notebook = /** @type {Notebook?} */ (null);

  const eventBus = new EventBus();
  const guest = new Guest(document.body, eventBus, {
    ...annotatorConfig,
    // Load the PDF anchoring/metadata integration.
    // nb. documentType is an internal config property only
    documentType: isPDF ? 'pdf' : 'html',
  });

  if (annotatorConfig.subFrameIdentifier) {
    // Other modules use this to detect if this
    // frame context belongs to hypothesis.
    // Needs to be a global property that's set.
    window_.__hypothesis_frame = true;
  } else {
    const sidebarConfig = getConfig('sidebar');

    const { sidebarAppUrl } = sidebarConfig;
    frameConnector = new FrameConnector({
      sidebarAppUrl,
    });
    frameConnector.listen();

    sidebar = new Sidebar(document.body, eventBus, guest, sidebarConfig);

    // Clear `annotations` value from the notebook's config to prevent direct-linked
    // annotations from filtering the threads.
    notebook = new Notebook(document.body, eventBus, getConfig('notebook'));
  }

  appLinkEl.addEventListener('destroy', () => {
    guest.destroy();
    frameConnector?.destroy();
    sidebar?.destroy();
    notebook?.destroy();

    // Remove all the `<link>`, `<script>` and `<style>` elements added to the
    // page by the boot script.
    const clientAssets = document.querySelectorAll('[data-hypothesis-asset]');
    clientAssets.forEach(el => el.remove());
  });
}

/**
 * Returns a Promise that resolves when the document has loaded (but subresources
 * may still be loading).
 * @returns {Promise<void>}
 */
function documentReady() {
  return new Promise(resolve => {
    if (document.readyState !== 'loading') {
      resolve();
    }
    // nb. `readystatechange` may be emitted twice, but `resolve` only resolves
    // on the first call.
    document.addEventListener('readystatechange', () => resolve());
  });
}

documentReady().then(init);
