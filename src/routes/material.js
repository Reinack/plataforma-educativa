const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../config/db');
const { requireLogin } = require('../middleware/auth');
const { tipoArchivo, TIPO_META } = require('../utils/fileTypes');

const router = express.Router();
router.use(requireLogin);

router.get('/', async (req, res) => {
  const { q, curso_id, tipo } = req.query;
  let sql = `
    SELECT m.*, c.titulo AS curso_titulo
    FROM material m LEFT JOIN cursos c ON m.curso_id = c.id
    WHERE 1=1
  `;
  const params = [];
  if (q && q.trim()) {
    sql += ' AND (LOWER(m.titulo) LIKE ? OR LOWER(m.descripcion) LIKE ? OR LOWER(m.archivo_nombre) LIKE ?)';
    const term = `%${q.trim().toLowerCase()}%`;
    params.push(term, term, term);
  }
  if (curso_id === 'general') {
    sql += ' AND m.curso_id IS NULL';
  } else if (curso_id) {
    sql += ' AND m.curso_id = ?';
    params.push(curso_id);
  }
  sql += ' ORDER BY m.fecha DESC';
  let materiales = await db.prepare(sql).all(...params);

  materiales.forEach(m => {
    m.tipo = tipoArchivo(m.mime_type, m.archivo_nombre);
    m.tipo_meta = TIPO_META[m.tipo];
  });

  if (tipo && TIPO_META[tipo]) {
    materiales = materiales.filter(m => m.tipo === tipo);
  }

  const cursos = await db.prepare('SELECT id, titulo FROM cursos ORDER BY titulo').all();

  res.render('material/lista', {
    title: 'Material Descargable',
    materiales, cursos, q, curso_id, tipo, TIPO_META
  });
});

router.get('/:id/descargar', async (req, res) => {
  const m = await db.prepare('SELECT * FROM material WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).render('errors/404', { title: 'No encontrado' });
  const full = path.join(__dirname, '..', '..', m.archivo_path);
  if (!fs.existsSync(full)) return res.status(404).render('errors/404', { title: 'Archivo no encontrado' });
  res.download(full, m.archivo_nombre);
});

module.exports = router;
