import React, { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, TextLayer, version as pdfVersion } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import AppState from './AppState';

GlobalWorkerOptions.workerSrc = workerUrl;

// Loaded only when a PDF is opened. Canvas rendering also works on mobile
// browsers without a native embedded PDF reader; the text layer is selectable.
export default function PolicyPdfViewer({ url, title, onReady }) {
  const [pdf, setPdf] = useState(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
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
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(200, entry.contentRect.width - 24)));
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
      if (!cancelled) { setRendering(false); readyRef.current(); }
    };
    render().catch((cause) => {
      if (!cancelled && cause.name !== 'RenderingCancelledException') {
        setError('This page could not be displayed. Try reopening the PDF or download the original.');
        setRendering(false);
      }
    });
    return () => { cancelled = true; renderTask?.cancel(); textLayer?.cancel(); };
  }, [pdf, page, width, zoom]);

  return (
    <div className="policy-pdf-viewer" aria-label={`${title} PDF reader`}>
      <div className="policy-pdf-controls"><div><button className="btn btn-outline" type="button" aria-label="Previous PDF page" disabled={!pdf || page <= 1 || rendering} onClick={() => setPage((value) => value - 1)}><i className="ri-arrow-left-s-line" aria-hidden="true" /></button><span aria-live="polite">Page {page} of {pdf?.numPages || '…'}</span><button className="btn btn-outline" type="button" aria-label="Next PDF page" disabled={!pdf || page >= pdf.numPages || rendering} onClick={() => setPage((value) => value + 1)}><i className="ri-arrow-right-s-line" aria-hidden="true" /></button></div>
        <label><span>Zoom</span><select value={zoom} onChange={(event) => setZoom(Number(event.target.value))}><option value={1}>Fit to width</option><option value={1.25}>125%</option><option value={1.5}>150%</option><option value={2}>200%</option></select></label>
      </div>
      {error && <AppState type="error" title="PDF reader unavailable" message={error} compact />}
      {!error && rendering && <div className="policy-pdf-loading" role="status">Loading page…</div>}
      <div className="policy-pdf-scroll" ref={containerRef} tabIndex="0" role="region" aria-label="PDF page, scroll to read" aria-busy={rendering && !error}>
        <div ref={pageRef} className="policy-pdf-page" style={{ visibility: rendering || error ? 'hidden' : 'visible' }}><canvas ref={canvasRef} aria-hidden="true" /><div ref={textRef} className="policy-pdf-text" /></div>
      </div>
    </div>
  );
}
