const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Convierte SQL estilo SQLite a PostgreSQL:
// - Reemplaza ? por $1, $2, ...
// - INSERT OR IGNORE -> INSERT ... ON CONFLICT DO NOTHING
// - datetime('now') -> NOW()
// - datetime(campo)  -> campo
// - COUNT(*) -> COUNT(*)::int
function pgify(sql) {
  let result = sql;
  const isIgnore = /INSERT\s+OR\s+IGNORE\s+INTO/i.test(result);
  result = result.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO');
  result = result.replace(/datetime\(\s*'now'\s*\)/gi, 'NOW()');
  result = result.replace(/datetime\(\s*([^)]+?)\s*\)/gi, '$1');
  result = result.replace(/COUNT\(([^)]*)\)/g, 'COUNT($1)::int');
  let i = 0;
  result = result.replace(/\?/g, () => `$${++i}`);
  if (isIgnore) result += ' ON CONFLICT DO NOTHING';
  return result;
}

const db = {
  pool,

  prepare(sql) {
    return {
      get: (...args) =>
        pool.query(pgify(sql), args).then(r => r.rows[0] || null),

      all: (...args) =>
        pool.query(pgify(sql), args).then(r => r.rows),

      run: (...args) => {
        let q = pgify(sql);
        if (/^\s*INSERT/i.test(sql) && !/RETURNING/i.test(q)) {
          q += ' RETURNING id';
        }
        return pool.query(q, args).then(r => ({
          lastInsertRowid: r.rows[0]?.id ?? null,
          changes: r.rowCount
        }));
      }
    };
  },

  async init() {
    await pool.query(SCHEMA);
    await ensureSeedData();
  }
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  rol TEXT NOT NULL DEFAULT 'alumno' CHECK (rol IN ('admin','alumno','soporte','profesor')),
  avatar TEXT,
  bio TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  fecha_creacion TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categorias (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS cursos (
  id SERIAL PRIMARY KEY,
  titulo TEXT NOT NULL,
  descripcion TEXT,
  categoria_id INTEGER REFERENCES categorias(id) ON DELETE SET NULL,
  instructor TEXT,
  thumbnail TEXT,
  publicado INTEGER NOT NULL DEFAULT 0,
  fecha_creacion TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS modulos (
  id SERIAL PRIMARY KEY,
  curso_id INTEGER NOT NULL REFERENCES cursos(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  orden INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lecciones (
  id SERIAL PRIMARY KEY,
  modulo_id INTEGER NOT NULL REFERENCES modulos(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  descripcion TEXT,
  video_url TEXT,
  video_path TEXT,
  duracion_min INTEGER DEFAULT 0,
  orden INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS inscripciones (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  curso_id INTEGER NOT NULL REFERENCES cursos(id) ON DELETE CASCADE,
  fecha TIMESTAMP DEFAULT NOW(),
  UNIQUE(usuario_id, curso_id)
);

CREATE TABLE IF NOT EXISTS progreso_lecciones (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  leccion_id INTEGER NOT NULL REFERENCES lecciones(id) ON DELETE CASCADE,
  completado INTEGER NOT NULL DEFAULT 1,
  fecha TIMESTAMP DEFAULT NOW(),
  UNIQUE(usuario_id, leccion_id)
);

CREATE TABLE IF NOT EXISTS clases_vivo (
  id SERIAL PRIMARY KEY,
  titulo TEXT NOT NULL,
  descripcion TEXT,
  instructor TEXT,
  instructor_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  fecha_hora TIMESTAMP NOT NULL,
  duracion_min INTEGER NOT NULL DEFAULT 60,
  link TEXT,
  curso_id INTEGER REFERENCES cursos(id) ON DELETE SET NULL,
  publicado INTEGER NOT NULL DEFAULT 1,
  fecha_creacion TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS material (
  id SERIAL PRIMARY KEY,
  titulo TEXT NOT NULL,
  descripcion TEXT,
  archivo_nombre TEXT NOT NULL,
  archivo_path TEXT NOT NULL,
  mime_type TEXT,
  tamano_bytes INTEGER,
  curso_id INTEGER REFERENCES cursos(id) ON DELETE SET NULL,
  fecha TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS posts_comunidad (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  curso_id INTEGER REFERENCES cursos(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  contenido TEXT NOT NULL,
  fijado INTEGER NOT NULL DEFAULT 0,
  fecha TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comentarios (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts_comunidad(id) ON DELETE CASCADE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  contenido TEXT NOT NULL,
  fecha TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS likes_post (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts_comunidad(id) ON DELETE CASCADE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  UNIQUE(post_id, usuario_id)
);

CREATE TABLE IF NOT EXISTS mensajes (
  id SERIAL PRIMARY KEY,
  remitente_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  destinatario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  contenido TEXT NOT NULL,
  leido INTEGER NOT NULL DEFAULT 0,
  fecha TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS certificados (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  curso_id INTEGER NOT NULL REFERENCES cursos(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL UNIQUE,
  fecha TIMESTAMP DEFAULT NOW(),
  UNIQUE(usuario_id, curso_id)
);

CREATE TABLE IF NOT EXISTS notificaciones (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  mensaje TEXT NOT NULL,
  link TEXT,
  leido INTEGER NOT NULL DEFAULT 0,
  fecha TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lecciones_modulo ON lecciones(modulo_id);
CREATE INDEX IF NOT EXISTS idx_modulos_curso ON modulos(curso_id);
CREATE INDEX IF NOT EXISTS idx_mensajes_destinatario ON mensajes(destinatario_id, leido);
CREATE INDEX IF NOT EXISTS idx_notif_usuario ON notificaciones(usuario_id, leido);
CREATE INDEX IF NOT EXISTS idx_progreso_usuario ON progreso_lecciones(usuario_id);
`;

async function ensureSeedData() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM usuarios');
  if (rows[0].c > 0) return;

  const adminHash = bcrypt.hashSync('admin123', 10);
  const alumnoHash = bcrypt.hashSync('alumno123', 10);
  const soporteHash = bcrypt.hashSync('soporte123', 10);
  const profesorHash = bcrypt.hashSync('profesor123', 10);

  await pool.query(
    "INSERT INTO usuarios (nombre, username, password_hash, rol, bio) VALUES ($1,$2,$3,'admin',$4)",
    ['Administrador', 'admin', adminHash, 'Cuenta del administrador del sistema.']
  );
  await pool.query(
    "INSERT INTO usuarios (nombre, username, password_hash, rol, bio) VALUES ($1,$2,$3,'alumno',$4)",
    ['Alumno Demo', 'alumno', alumnoHash, 'Estudiante de prueba.']
  );
  await pool.query(
    "INSERT INTO usuarios (nombre, username, password_hash, rol, bio) VALUES ($1,$2,$3,'soporte',$4)",
    ['Soporte Demo', 'soporte', soporteHash, 'Equipo de soporte.']
  );
  await pool.query(
    "INSERT INTO usuarios (nombre, username, password_hash, rol, bio) VALUES ($1,$2,$3,'profesor',$4)",
    ['Profesor Demo', 'profesor', profesorHash, 'Profesor de la plataforma.']
  );

  for (const c of ['Programación', 'Diseño', 'Marketing', 'Idiomas', 'Negocios']) {
    await pool.query('INSERT INTO categorias (nombre) VALUES ($1) ON CONFLICT DO NOTHING', [c]);
  }

  const catRes = await pool.query("SELECT id FROM categorias WHERE nombre = 'Programación'");
  const catId = catRes.rows[0]?.id || 1;

  const cursoRes = await pool.query(
    "INSERT INTO cursos (titulo, descripcion, categoria_id, instructor, publicado) VALUES ($1,$2,$3,$4,1) RETURNING id",
    ['Introducción a JavaScript', 'Curso básico de JavaScript desde cero.', catId, 'Prof. García']
  );
  const cursoId = cursoRes.rows[0].id;

  const modRes = await pool.query(
    'INSERT INTO modulos (curso_id, titulo, orden) VALUES ($1,$2,1) RETURNING id',
    [cursoId, 'Módulo 1 - Fundamentos']
  );
  const modId = modRes.rows[0].id;

  await pool.query(
    'INSERT INTO lecciones (modulo_id, titulo, descripcion, video_url, duracion_min, orden) VALUES ($1,$2,$3,$4,$5,$6)',
    [modId, 'Bienvenida', 'Presentación del curso.', 'https://www.youtube.com/embed/W6NZfCO5SIk', 5, 1]
  );
  await pool.query(
    'INSERT INTO lecciones (modulo_id, titulo, descripcion, video_url, duracion_min, orden) VALUES ($1,$2,$3,$4,$5,$6)',
    [modId, 'Variables y tipos', 'Aprende sobre let, const y tipos primitivos.', 'https://www.youtube.com/embed/W6NZfCO5SIk', 15, 2]
  );
}

module.exports = db;
