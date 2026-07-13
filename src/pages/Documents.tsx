import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { saveDocument, getAllDocuments, deleteDocument, getDocument, type DocRecord } from '@/lib/pdfStorage';
import PdfViewer from '@/components/documents/PdfViewer';
import { FileText, Upload, Trash2, Eye, Search, FileArchive, X, ArrowUpDown, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

export default function Documents() {
  const [documents, setDocuments] = useState<DocRecord[]>([]);
  const [search, setSearch] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [viewingPdf, setViewingPdf] = useState<{ url: string; filename: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Load document list on mount
  const loadDocuments = useCallback(async () => {
    try {
      const docs = await getAllDocuments();
      setDocuments(docs);
    } catch (e) {
      console.error('Failed to load documents:', e);
    }
  }, []);

  useEffect(() => { loadDocuments(); }, [loadDocuments]);

  // Handle file upload
  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const fileArr = Array.from(files).filter(f => f.type === 'application/pdf');
    if (fileArr.length === 0) {
      toast({ title: '僅支援 PDF 檔案', variant: 'destructive' });
      return;
    }
    setUploading(true);
    let count = 0;
    for (const file of fileArr) {
      try {
        await saveDocument(file);
        count++;
      } catch (e: any) {
        toast({ title: `上傳失敗: ${file.name}`, description: e.message, variant: 'destructive' });
      }
    }
    if (count > 0) {
      toast({ title: `成功上傳 ${count} 個檔案` });
    }
    setUploading(false);
    loadDocuments();
  }, [toast, loadDocuments]);

  // Drag & drop handlers
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  // View PDF
  const viewPdf = async (doc: DocRecord) => {
    const record = await getDocument(doc.id);
    if (!record) {
      toast({ title: '找不到檔案', description: '請重新上傳', variant: 'destructive' });
      return;
    }
    const url = URL.createObjectURL(record.data);
    setViewingPdf({ url, filename: doc.name });
  };

  // Delete document
  const handleDelete = async (id: string, name: string) => {
    try {
      await deleteDocument(id);
      toast({ title: `已刪除: ${name}` });
      loadDocuments();
    } catch (e: any) {
      toast({ title: '刪除失敗', variant: 'destructive' });
    }
  };

  // Close viewer and revoke URL
  const closeViewer = () => {
    if (viewingPdf) {
      URL.revokeObjectURL(viewingPdf.url);
      setViewingPdf(null);
    }
  };

  // Filter documents by search
  const filtered = documents.filter(d =>
    d.name.toLowerCase().includes(search.toLowerCase())
  );

  // Format file size
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">文件管理</h1>
        <p className="text-muted-foreground mt-1">上傳、儲存和閲讀 PDF 文件</p>
      </div>

      {/* Upload Area */}
      <div
        className={cn(
          "relative border-2 border-dashed rounded-xl p-10 text-center transition-all cursor-pointer",
          dragOver
            ? "border-primary bg-primary/5 scale-[1.01]"
            : "border-muted-foreground/25 hover:border-muted-foreground/50 hover:bg-muted/30",
          uploading && "opacity-50 pointer-events-none"
        )}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          multiple
          className="hidden"
          onChange={e => e.target.files && handleFiles(e.target.files)}
        />
        {uploading ? (
          <div className="flex flex-col items-center gap-2">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">上傳中...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="p-4 rounded-full bg-primary/10">
              <Upload className="h-8 w-8 text-primary" />
            </div>
            <div>
              <p className="font-medium">拖拽 PDF 檔案到這裡，或點擊上傳</p>
              <p className="text-sm text-muted-foreground mt-1">支援多個 PDF 檔案同時上傳</p>
            </div>
          </div>
        )}
      </div>

      {/* Search + Stats */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜尋文件..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <span className="text-sm text-muted-foreground">
          共 {documents.length} 個文件
        </span>
      </div>

      {/* Document List */}
      {filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <FileArchive className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground">
              {documents.length === 0 ? '尚未上傳任何 PDF 文件' : '沒有符合搜尋條件的文件'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map(doc => (
            <Card key={doc.id} className="hover:bg-muted/30 transition-colors group">
              <CardContent className="flex items-center gap-4 py-4 px-5">
                <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950 shrink-0">
                  <FileText className="h-6 w-6 text-red-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{doc.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatSize(doc.size)} · {(() => {
                      try { return format(new Date(doc.createdAt), 'yyyy-MM-dd HH:mm'); }
                      catch { return doc.createdAt; }
                    })()}
                  </p>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="sm" onClick={() => viewPdf(doc)}>
                    <Eye className="h-4 w-4 mr-1" /> 閲讀
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(doc.id, doc.name)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* PDF Viewer Modal */}
      {viewingPdf && (
        <PdfViewer
          pdfUrl={viewingPdf.url}
          filename={viewingPdf.filename}
          onClose={closeViewer}
        />
      )}
    </div>
  );
}
