import React, { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, TextLayer, version as pdfVersion } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import AppState from './AppState';
import useDialogFocus from '../hooks/useDialogFocus';

GlobalWorkerOptions.workerSrc = workerUrl;

// Loaded only when a PDF is opened. Canvas rendering also works on mobile
// browsers without a native embedded PDF reader; the text layer is selectable.
export default function PolicyPdfViewer({ url, title, onReady }) {
  const [expanded, setExpanded] = useState(false);
  const viewerRef = useDialogFocus(expanded, () => setExpanded(false));
  const [pdf, setPdf] = useState(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const lastRenderedPage = useRef(null);
  const [width, setWidth] = useState(0);
  const [rendering, setRendering] = useState(true);
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const pageRef = useRef(null);
  const textRef = useRef(null);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  useEffect(() => {
    let cancelled = false;
    const resources = `${import.meta.env.BASE_URL}pdf-reader-assets/${pdfVersion}/`;
    const task = getDocument({ url, isEvalSupported: false,
      cMapUrl: `${resources}cmaps/`, cMapPacked: true,
      standardFontDataUrl: `${resources}standard_fonts/`, wasmUrl: `${resources}wasm/`,
    });
    task.promise.then((document) => { if (!cancelled) setPdf(document); }).catch((cause) => {
      if (!cancelled) setError(cause.name === 'PasswordException' ? 'This PDF is password-protected. Ask an Admin to upload an unlocked copy.' : 'This PDF could not be displayed. Try downloading it, or ask an Admin to replace the file.');
    });
    return () => { cancelled = true; void task.destroy(); };
  }, [url]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(200, entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdf || !width) return undefined;
    let cancelled = false;
    let renderTask;
    let textLayer;
    setRendering(true); setError('');
    const canvas = canvasRef.current;
    const textContainer = textRef.current;
    const render = async () => {
      const pdfPage = await pdf.getPage(page);
      if (cancelled) return;
      const original = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({ scale: Math.min(width / original.width, 1.5) * zoom });
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * pixelRatio);
      canvas.height = Math.floor(viewport.height * pixelRatio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      pageRef.current.style.width = `${viewport.width}px`;
      pageRef.current.style.height = `${viewport.height}px`;
      textContainer.replaceChildren();
      textContainer.style.setProperty('--total-scale-factor', viewport.scale);
      renderTask = pdfPage.render({ canvas, viewport, transform: [pixelRatio, 0, 0, pixelRatio, 0, 0] });
      await renderTask.promise;
      if (cancelled) return;
      textLayer = new TextLayer({ textContentSource: pdfPage.streamTextContent(), container: textContainer, viewport });
      await textLayer.render();
      if (!cancelled) {
        // Reset only for a different page, after its final dimensions are known.
        // Resizing and zooming should preserve the reader's place.
        if (lastRenderedPage.current !== page) {
          containerRef.current.scrollTo({ top: 0, left: 0, behavior: 'instant' });
          lastRenderedPage.current = page;
        }
        setRendering(false);
        readyRef.current();
      }
    };
    render().catch((cause) => {
      if (!cancelled && cause.name !== 'RenderingCancelledException') {
        setError('This page could not be displayed. Try reopening the PDF or download the original.');
        setRendering(false);
      }
    });
    return () => { cancelled = true; renderTask?.cancel(); textLayer?.cancel(); };
  }, [pdf, page, width, zoom]);

  const goToPage = (target) => {
    if (!pdf || rendering || !Number.isInteger(target) || target < 1 || target > pdf.numPages) {
      setPageInput(String(page));
      return;
    }
    setPageInput(String(target));
    if (target !== page) {
      setRendering(true);
      setPage(target);
    }
  };

  const navigation = (location) => (
    <nav className="policy-pdf-navigation" aria-label={`${location} PDF page navigation`}>
      <button className="btn btn-outline" type="button" aria-label="Previous PDF page" disabled={!pdf || page <= 1 || rendering} onClick={() => goToPage(page - 1)}><i className="ri-arrow-left-s-line" aria-hidden="true" /> Previous</button>
      {location === 'Top' ? <form noValidate className="policy-page-jump" onSubmit={(event) => { event.preventDefault(); goToPage(Number(pageInput)); }}>
        <label><span>Page</span><input aria-label="PDF page number" type="number" min="1" max={pdf?.numPages || 1} value={pageInput} disabled={!pdf || rendering} onChange={(event) => setPageInput(event.target.value)} onBlur={() => setPageInput(String(page))} /></label>
        <span>of {pdf?.numPages || '…'}</span>
      </form> : <span aria-live="polite">{page} / {pdf?.numPages || '…'}</span>}
      <button className="btn btn-outline" type="button" aria-label="Next PDF page" disabled={!pdf || page >= pdf.numPages || rendering} onClick={() => goToPage(page + 1)}>Next <i className="ri-arrow-right-s-line" aria-hidden="true" /></button>
    </nav>
  );

  return (
    <div ref={viewerRef} className={`policy-pdf-viewer${expanded ? ' policy-pdf-viewer--expanded' : ''}`} role={expanded ? 'dialog' : undefined} aria-modal={expanded || undefined} tabIndex={expanded ? -1 : undefined} aria-label={`${title} PDF reader`}>
      <div className="policy-pdf-controls">
        {navigation('Top')}
        <button className="btn btn-outline policy-expand" type="button" aria-pressed={expanded} onClick={() => setExpanded((value) => !value)}><i className={expanded ? 'ri-contract-left-right-line' : 'ri-expand-left-right-line'} aria-hidden="true" />{expanded ? 'Exit reading view' : 'Expand reader'}</button>
        <label><span>View</span><select aria-label="PDF zoom" value={zoom} onChange={(event) => setZoom(Number(event.target.value))}><option value={1}>Fit to width</option><option value={1.25}>1.25× width</option><option value={1.5}>1.5× width</option><option value={2}>2× width</option></select></label>
      </div>
      {error && <AppState type="error" title="PDF reader unavailable" message={error} compact />}
      <div className="policy-pdf-stage">
        {!error && rendering && <div className="policy-pdf-loading" role="status">Loading page {page}…</div>}
        <div className="policy-pdf-scroll" ref={containerRef} tabIndex="0" role="region" aria-label="PDF page, scroll to read. Use left and right arrow keys to change pages." aria-busy={rendering && !error} onKeyDown={(event) => {
          if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || zoom !== 1) return;
          if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            event.preventDefault();
            goToPage(page + (event.key === 'ArrowRight' ? 1 : -1));
          }
        }}>
          <div ref={pageRef} className="policy-pdf-page" style={{ visibility: rendering || error ? 'hidden' : 'visible' }}><canvas ref={canvasRef} aria-hidden="true" /><div ref={textRef} className="policy-pdf-text" /></div>
        </div>
      </div>
      <div className="policy-pdf-footer">{navigation('Bottom')}<span className="policy-pdf-hint">{pdf && page === pdf.numPages ? 'End of document' : 'Each page opens at the top'}</span></div>
    </div>
  );
}
