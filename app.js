// app.js — XYZ College CET Examination System
require('dotenv').config();
const express      = require('express');
const session      = require('express-session');
const flash        = require('connect-flash');
const fileUpload   = require('express-fileupload');
const methodOverride = require('method-override');
const path         = require('path');

const { testConnection, sequelize } = require('./config/database');
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
  cookie: { maxAge: parseInt(process.env.SESSION_MAX_AGE) || 86400000, httpOnly: true },
}));

app.use(flash());
app.use(attachUser); // injects currentUser + flash into res.locals

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/auth',    require('./routes/auth'));
app.use('/admin',   require('./routes/admin'));
app.use('/teacher', require('./routes/teacher'));
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

  app.listen(PORT, () => {
    console.log(`\n🚀 ${process.env.APP_NAME}`);
    console.log(`   Running at: http://localhost:${PORT}`);
    console.log(`   Environment: ${process.env.NODE_ENV}\n`);
  });
})();
