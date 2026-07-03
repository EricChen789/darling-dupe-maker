import { useState, useEffect, useRef, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCw, X } from 'lucide-react';
import { cn } from '@/lib/utils';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

interface PdfViewerProps {
  pdfUrl: string;
  filename: string;
  onClose: () => void;
}

export default function PdfViewer({ pdfUrl, filename, onClose }: PdfViewerProps) {
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.2);
  const [rotation, setRotation] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load PDF
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const loadPdf = async () => {
      try {
        const doc = await pdfjsLib.getDocument({ url: pdfUrl, cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/', cMapPacked: true }).promise;
        if (cancelled) return;
        setPdfDoc(doc);
        setTotalPages(doc.numPages);
        setPageNum(1);
        setLoading(false);
      } catch (e: any) {
        if (!cancelled) {
          setError(e.message || '無法載入 PDF');
          setLoading(false);
        }
      }
    };

    loadPdf();
    return () => { cancelled = true; };
  }, [pdfUrl]);

  // Render current page
  const renderPage = useCallback(async () => {
    if (!pdfDoc || !canvasRef.current) return;
    setRendering(true);
    try {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale, rotation });
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d')!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      await page.render({ canvasContext: ctx, viewport }).promise;
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRendering(false);
    }
  }, [pdfDoc, pageNum, scale, rotation]);

  useEffect(() => {
    renderPage();
  }, [renderPage]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') goToPage(pageNum - 1);
      if (e.key === 'ArrowRight') goToPage(pageNum + 1);
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [pageNum, totalPages]);

  const goToPage = (n: number) => {
    if (n >= 1 && n <= totalPages) setPageNum(n);
  };

  const zoomIn = () => setScale(s => Math.min(s + 0.2, 3));
  const zoomOut = () => setScale(s => Math.max(s - 0.2, 0.4));
  const rotate = () => setRotation(r => (r + 90) % 360);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-background border-b shrink-0">
        <span className="font-medium text-sm truncate max-w-xs">{filename}</span>
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={zoomOut} disabled={scale <= 0.4} title="縮小">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground w-12 text-center">{Math.round(scale * 100)}%</span>
          <Button variant="ghost" size="icon" onClick={zoomIn} disabled={scale >= 3} title="放大">
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={rotate} title="旋轉">
            <RotateCw className="h-4 w-4" />
          </Button>
          <div className="w-px h-6 bg-border mx-1" />
          <Button variant="ghost" size="icon" onClick={() => goToPage(pageNum - 1)} disabled={pageNum <= 1}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-1 text-sm">
            <Input
              type="number"
              value={pageNum}
              onChange={e => goToPage(parseInt(e.target.value) || 1)}
              min={1}
              max={totalPages}
              className="w-14 h-8 text-center text-sm"
            />
            <span className="text-muted-foreground">/ {totalPages}</span>
          </div>
          <Button variant="ghost" size="icon" onClick={() => goToPage(pageNum + 1)} disabled={pageNum >= totalPages}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <div className="w-px h-6 bg-border mx-1" />
          <Button variant="ghost" size="icon" onClick={onClose} title="關閉 (Esc)">
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div ref={containerRef} className="flex-1 overflow-auto flex justify-center p-4">
        {loading && (
          <div className="flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}
        {error && (
          <div className="flex items-center justify-center">
            <div className="text-center">
              <p className="text-red-500 mb-2">載入失敗</p>
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button variant="outline" className="mt-4" onClick={onClose}>關閉</Button>
            </div>
          </div>
        )}
        <div className={cn("relative", loading || error ? 'hidden' : '')}>
          {rendering && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/50 rounded">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}
          <canvas ref={canvasRef} className="shadow-2xl rounded-sm" />
        </div>
      </div>
    </div>
  );
}
