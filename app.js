// app.js — XYZ College CET Examination System
require('dotenv').config();
const express      = require('express');
const session      = require('express-session');
const flash        = require('connect-flash');
const fileUpload   = require('express-fileupload');
const methodOverride = require('method-override');
const path         = require('path');

const { testConnection, sequelize } = require('./config/database');
const SequelizeStore = require('connect-session-sequelize')(session.Store);

// Persistent session store — works across Vercel serverless invocations
const sessionStore = new SequelizeStore({ db: sequelize, checkExpirationInterval: 15 * 60 * 1000, expiration: 24 * 60 * 60 * 1000 });
require('./models'); // register all models & associations

const { attachUser, errorHandler, notFound } = require('./middleware/auth');

const app = express();

// ── View engine ───────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(fileUpload({ limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024 } }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'xyz_college_secret',
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    maxAge: parseInt(process.env.SESSION_MAX_AGE) || 86400000,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // HTTPS only in prod
    sameSite: 'lax',
  },
}));

app.use(flash());
app.use(attachUser); // injects currentUser + flash into res.locals

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/auth',    require('./routes/auth'));
app.use('/admin',   require('./routes/admin'));
app.use('/student', require('./routes/student'));
app.use('/exam',    require('./routes/exam'));
app.use('/results', require('./routes/results'));

// Root redirect
app.get('/', (req, res) => {
  if (req.session.user) return res.redirect(`/${req.session.user.role}/dashboard`);
  res.redirect('/auth/login');
});

// ── Error handling ────────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── Start server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

(async () => {
  await testConnection();
  await sequelize.sync({ alter: process.env.NODE_ENV === 'development' });
  console.log('✅ Models synced');

  // ── Auto-seed admin from .env (only if no admin exists) ──────────────────
  try {
    const { User } = require('./models');
    const exists = await User.findOne({ where: { role: 'admin' } });
    if (!exists) {
      const adminEmail    = process.env.ADMIN_EMAIL    || 'admin@college.edu';
      const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@1234';
      const adminName     = process.env.ADMIN_NAME     || 'Administrator';
      await User.create({ name: adminName, email: adminEmail, password: adminPassword, role: 'admin', isActive: true, isFirstLogin: false });
      console.log(`✅ Admin seeded — email: ${adminEmail}`);
      console.log(`   ⚠  Change ADMIN_PASSWORD in .env after first login!`);
    }
  } catch (e) {
    console.error('Admin seed error:', e.message);
  }

  app.listen(PORT, () => {
    console.log(`\n${process.env.APP_NAME || 'CET Exam Portal'}`);
    console.log(`   Running at: http://localhost:${PORT}`);
    console.log(`   Environment: ${process.env.NODE_ENV}\n`);
  });
})();
