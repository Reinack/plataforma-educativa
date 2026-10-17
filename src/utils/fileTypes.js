function tipoArchivo(mime, nombre) {
  if (!mime) mime = '';
  const ext = (nombre || '').split('.').pop().toLowerCase();
  if (mime.includes('pdf') || ext === 'pdf') return 'pdf';
  if (mime.startsWith('image/') || ['jpg','jpeg','png','gif','webp','svg','bmp'].includes(ext)) return 'imagen';
  if (mime.startsWith('video/') || ['mp4','mov','avi','mkv','webm'].includes(ext)) return 'video';
  if (mime.startsWith('audio/') || ['mp3','wav','ogg','m4a'].includes(ext)) return 'audio';
  if (mime.includes('word') || mime.includes('document') || ['doc','docx','odt','rtf','txt'].includes(ext)) return 'documento';
  if (mime.includes('sheet') || mime.includes('excel') || ['xls','xlsx','csv','ods'].includes(ext)) return 'planilla';
  if (mime.includes('presentation') || mime.includes('powerpoint') || ['ppt','pptx','odp'].includes(ext)) return 'presentacion';
  if (mime.includes('zip') || mime.includes('rar') || ['zip','rar','7z','tar','gz'].includes(ext)) return 'comprimido';
  return 'otro';
}

const TIPO_META = {
  pdf:           { label: 'PDF',           icon: 'bi-file-earmark-pdf',  color: '#ef4444' },
  imagen:        { label: 'Imagen',        icon: 'bi-file-earmark-image', color: '#0ea5e9' },
  video:         { label: 'Video',         icon: 'bi-file-earmark-play', color: '#a855f7' },
  audio:         { label: 'Audio',         icon: 'bi-file-earmark-music', color: '#ec4899' },
  documento:     { label: 'Documento',     icon: 'bi-file-earmark-text', color: '#3b82f6' },
  planilla:      { label: 'Planilla',      icon: 'bi-file-earmark-spreadsheet', color: '#10b981' },
  presentacion:  { label: 'Presentación',  icon: 'bi-file-earmark-slides', color: '#f59e0b' },
  comprimido:    { label: 'Comprimido',    icon: 'bi-file-earmark-zip', color: '#6b7280' },
  otro:          { label: 'Otro',          icon: 'bi-file-earmark', color: '#94a3b8' }
};

module.exports = { tipoArchivo, TIPO_META };
