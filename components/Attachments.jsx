'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { attachments as attApi } from '@/lib/api';
import { getToken } from '@/lib/auth';
import toast from 'react-hot-toast';
import { Paperclip, Upload, Trash2, FileText, Image as ImageIcon, Download } from 'lucide-react';

const fmtSize = (b) => {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
};

const iconFor = (mime) => (mime?.startsWith('image/') ? ImageIcon : FileText);

/**
 * Reusable attachments panel. Drop into any detail view:
 *   <Attachments entity="Bill" entityId={bill.id} />
 */
export default function Attachments({ entity, entityId, readOnly = false }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef(null);

  const load = useCallback(() => {
    if (!entityId) return;
    setLoading(true);
    attApi.list(entity, entityId)
      .then((r) => setItems(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [entity, entityId]);

  useEffect(() => { load(); }, [load]);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await attApi.upload(entity, entityId, file);
      toast.success('File uploaded');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this attachment?')) return;
    try {
      await attApi.remove(id);
      toast.success('Attachment deleted');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Delete failed');
    }
  };

  // Open the authenticated download URL in a new tab via fetch -> blob,
  // since the endpoint requires the Authorization header.
  const handleOpen = async (att) => {
    try {
      const res = await fetch(attApi.downloadUrl(att.id), {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      toast.error('Could not open file');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
          <Paperclip className="w-4 h-4 text-gray-400" /> Attachments {items.length > 0 && <span className="text-gray-400">({items.length})</span>}
        </h4>
        {!readOnly && (
          <>
            <input ref={inputRef} type="file" className="hidden" onChange={handleFile}
              accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.xls,.xlsx,.doc,.docx,.csv,.txt" />
            <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
              className="btn-secondary btn-sm">
              <Upload className="w-3.5 h-3.5" /> {uploading ? 'Uploading…' : 'Upload'}
            </button>
          </>
        )}
      </div>

      {loading ? (
        <p className="text-xs text-gray-400 py-2">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-gray-400 py-2">No files attached.</p>
      ) : (
        <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
          {items.map((a) => {
            const Icon = iconFor(a.mimeType);
            return (
              <li key={a.id} className="flex items-center gap-3 px-3 py-2">
                <Icon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <button onClick={() => handleOpen(a)} className="flex-1 text-left text-sm text-blue-600 hover:underline truncate">
                  {a.originalName}
                </button>
                <span className="text-xs text-gray-400">{fmtSize(a.size)}</span>
                <button onClick={() => handleOpen(a)} className="p-1 text-gray-400 hover:text-blue-600" title="Open"><Download className="w-4 h-4" /></button>
                {!readOnly && (
                  <button onClick={() => handleDelete(a.id)} className="p-1 text-gray-400 hover:text-red-600" title="Delete"><Trash2 className="w-4 h-4" /></button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
