# Plataforma Educativa

> Full-featured Learning Management System built with Node.js + Express + PostgreSQL. Supports courses with video lessons, live class scheduling, community forum, direct messaging, file materials, certificates, and a complete admin panel — all with role-based access.

**Deploy**: Render + Neon PostgreSQL (zero-config self-hosted schema on first run)

[---](https://plataforma-educativa-1-u6tk.onrender.com)

## Features

### For Students (`alumno`)
- Browse and enroll in published courses
- Watch video lessons with progress tracking
- Download course materials (PDF, DOCX, images, etc.)
- Participate in the community forum (posts, comments, likes)
- Attend scheduled live classes (Zoom / Meet link integration)
- Direct messaging with other users
- View completed certificates

### For Instructors (`profesor`)
- Manage their own live class schedule
- Create community posts for their courses
- View enrolled students

### For Support (`soporte`)
- Community moderation access

### For Admins (`admin`)
- Full CRUD: users, courses, modules, lessons, live classes, materials, categories
- Upload videos directly to the platform
- Manage community and messaging
- Dashboard with platform statistics

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js >= 20 |
| Framework | Express 4 |
| Templates | EJS + express-ejs-layouts |
| Database | PostgreSQL (Neon / Render / local) |
| ORM | Raw SQL with `pg` driver — auto-migrating schema |
| Auth | express-session + bcryptjs + connect-pg-simple |
| File uploads | Multer v2 (materials + video) |
| Flash messages | connect-flash |
| Deploy | Render (render.yaml) |

---

## Database Schema

Schema is created automatically on first startup — no migration step needed.

| Table | Purpose |
|---|---|
| `usuarios` | Users with roles: admin, alumno, soporte, profesor |
| `cursos` | Course catalog with categories |
| `modulos` / `lecciones` | Course structure: modules → lessons + video URLs |
| `inscripciones` | Course enrollments |
| `progreso_lecciones` | Per-user lesson completion |
| `clases_vivo` | Scheduled live classes with Zoom/Meet link |
| `material` | Downloadable files attached to courses |
| `posts_comunidad` / `comentarios` / `likes_post` | Community forum |
| `mensajes` | Direct messages between users |
| `certificados` | Completion certificates per course |
| `notificaciones` | In-app notification system |

---

## Project Structure

```
plataforma-educativa/
├── server.js              # Express app, session config, route mounting
├── src/
│   ├── config/db.js       # pg Pool, pgify() SQL adapter, schema init, seed
│   ├── middleware/auth.js  # requireLogin / requireAdmin guards
│   ├── routes/            # One file per module
│   │   ├── auth.js        # Login / logout
│   │   ├── dashboard.js   # Student home
│   │   ├── cursos.js      # Course browsing, enrollment, video player
│   │   ├── clases.js      # Live class listing and detail
│   │   ├── material.js    # File downloads
│   │   ├── comunidad.js   # Forum: posts, comments, likes
│   │   ├── mensajes.js    # Direct messages
│   │   ├── notificaciones.js
│   │   ├── perfil.js      # User profile
│   │   ├── manual.js      # Help / user guide
│   │   └── admin.js       # Full admin CRUD
│   └── utils/
│       ├── helpers.js     # Date formatting, truncation, etc.
│       └── fileTypes.js   # MIME type detection for uploads
├── views/                 # EJS templates per module
├── public/css/            # Global styles
├── .env.example           # Required environment variables
├── render.yaml            # Render one-click deploy config
└── Dockerfile             # Container support (+ docker-compose.yml)
```

---

## Getting Started

### Prerequisites
- Node.js >= 20
- PostgreSQL database (local, [Neon](https://neon.tech), [Supabase](https://supabase.com), etc.)

### Local Setup

```bash
git clone https://github.com/Reinack/plataforma-educativa.git
cd plataforma-educativa

npm install

cp .env.example .env
# Edit .env — set DATABASE_URL and SESSION_SECRET
```

**.env** minimum:
```env
DATABASE_URL=postgresql://user:pass@host/dbname
SESSION_SECRET=a-long-random-string
```

```bash
npm start
```

Open **http://localhost:3000** — the schema and seed data are created automatically.

### Demo Credentials

| Role | Username | Password |
|---|---|---|
| Admin | `admin` | `admin123` |
| Student | `alumno` | `alumno123` |
| Instructor | `profesor` | `profesor123` |
| Support | `soporte` | `soporte123` |

### With Docker

```bash
cp .env.example .env   # set SESSION_SECRET at minimum
docker compose up
```

PostgreSQL + the app start together. Schema initializes on first boot.

---

## Deploy to Render

1. Fork / clone this repo
2. Create a **PostgreSQL** database on [Neon](https://neon.tech) (free tier available)
3. Create a **Web Service** on Render connected to your GitHub repo
4. Set environment variables:
   - `DATABASE_URL` — your Neon connection string
   - `SESSION_SECRET` — any long random string
   - `NODE_ENV=production`
5. Build command: `npm install`
6. Start command: `node server.js`

The `render.yaml` in this repo configures the service automatically.

---

## License

MIT
