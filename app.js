// app.js — CET Examination System (MongoDB / Mongoose)
require('dotenv').config();
const express        = require('express');
const session        = require('express-session');
const flash          = require('connect-flash');
const fileUpload     = require('express-fileupload');
const methodOverride = require('method-override');
const path           = require('path');
const compression    = require('compression');
const helmet         = require('helmet');
const { MongoStore } = require('connect-mongo');

const { connect } = require('./config/database');
const { APP_TIME_ZONE } = require('./utils/dateTime');
require('./models'); // register all schemas

const { attachUser, attachOrganization, errorHandler, notFound } = require('./middleware/auth');

const app = express();
app.set('trust proxy', 1);

// ── Security ──────────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// ── Compression ───────────────────────────────────────────────────────────────
app.use(compression({ level: 6, threshold: 1024 }));

// ── View engine ───────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.locals.appTimeZone = APP_TIME_ZONE;

// ── Static files ──────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '7d', etag: true, lastModified: true,
  setHeaders: (res, fp) => {
    if (fp.endsWith('.html') || fp.endsWith('.json'))
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    else if (/\.(js|css|png|jpg|jpeg|svg|ico|woff2?)$/.test(fp))
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  },
}));
app.use('/brand', express.static(path.join(__dirname, 'mobile', 'assets'), {
  maxAge: '30d',
  immutable: true,
}));
app.use('/vendor/katex', express.static(path.join(__dirname, 'node_modules', 'katex', 'dist'), {
  maxAge: '30d',
  immutable: true,
}));

// ── Body / file parsers ───────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true, limit: '10mb', parameterLimit: 20000 }));
app.use(express.json({ limit: '10mb' }));
app.use(methodOverride('_method'));
app.use(fileUpload({
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 20 * 1024 * 1024 },
  useTempFiles: false,
  abortOnLimit: true,
}));

// ── Sessions (stored in MongoDB) ──────────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/svpn_test';

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET && process.env.NODE_ENV === 'production') {
  console.error('❌ SESSION_SECRET env var is not set. This is a security risk in production. Exiting.');
  process.exit(1);
}

app.use(session({
  secret: SESSION_SECRET || 'svpn_secret_key_dev_only',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: MONGO_URI,
    ttl: 24 * 60 * 60,        // 1 day
    autoRemove: 'native',
  }),
  cookie: {
    maxAge: parseInt(process.env.SESSION_MAX_AGE) || 86400000,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  },
}));

app.use(flash());
app.use(attachUser);

// ── No-cache for HTML pages ───────────────────────────────────────────────────
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/uploads'))
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  next();
});

// Connect before any web or mobile route handles a request. This also covers
// serverless deployments, where `require.main === module` is false.
app.use(async (req, res, next) => {
  try { await boot(); next(); }
  catch (e) { res.status(500).send('Server init failed: ' + e.message); }
});
app.use(attachOrganization);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/auth',    require('./routes/auth'));
app.use('/admin',   require('./routes/admin'));
app.use('/student', require('./routes/student'));
app.use('/exam',    require('./routes/exam'));
app.use('/results', require('./routes/results'));
app.use('/api/mobile', require('./routes/mobileApi'));

app.get('/', (req, res) => {
  if (req.session.user) return res.redirect(`/${req.session.user.role}/dashboard`);
  res.render('landing', {
    title: 'Shardabai Pawar Vidya Niketan',
    officialContact: {
      phone: process.env.COLLEGE_PHONE || '+91 2112 254832',
      email: process.env.COLLEGE_EMAIL || 'ghodkeamoladt@gmail.com',
      website: process.env.COLLEGE_WEBSITE || 'https://www.adtschool.co.in',
      websiteLabel: process.env.COLLEGE_WEBSITE_LABEL || 'adtschool.co.in',
    },
    campusPhoto: {
      url: 'https://feeds.abplive.com/onecms/images/uploaded-images/2024/03/05/fac88e6a6364c2bf1a5534774ab5f81f1709636690386442_original.png',
      sourceUrl: 'https://marathi.abplive.com/news/pune/baramati-news-shardabai-pawar-vidyaniketan-shardanagar-school-ranks-second-in-the-state-1261974',
      sourceLabel: 'ABP Majha',
    },
    campusMap: {
      url: process.env.COLLEGE_MAP_URL || 'https://www.google.com/maps/search/?api=1&query=Shardabai%20Pawar%20Vidya%20Niketan%20%28SPVN%29%2C%20Shardanagar&query_place_id=ChIJ0wZeTvugwzsRNpZjXEek0VE',
      label: 'Shardabai Pawar Vidya Mandir & Vidya Niketan, Shardanagar, Baramati',
    },
  });
});

// ── Boot ──────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
let bootPromise = null;

function boot() {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    await connect();

    // Replace the early question-paper index that attempted to combine two
    // array fields. MongoDB cannot index parallel arrays in one compound index.
    const { QuestionPaper } = require('./models');
    await QuestionPaper.ensureCompatibleIndexes();

    // Backward-compatible default organization + auto-seed admin.
    try {
      const { User } = require('./models');
      const { ensureDefaultOrganization } = require('./services/organizationService');
      const organization = await ensureDefaultOrganization();
      let admin = await User.findOne({ role: 'admin' }).sort({ createdAt: 1 });
      if (!admin) {
        const adminEmail    = process.env.ADMIN_EMAIL    || 'admin@college.edu';
        const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@1234';
        const adminName     = process.env.ADMIN_NAME     || 'Administrator';
        admin = await User.create({
          name: adminName,
          email: adminEmail,
          password: adminPassword,
          role: 'admin',
          organization: organization._id,
          isSuperAdmin: true,
          isActive: true,
          isFirstLogin: false,
        });
        console.log(`✅ Admin seeded → ${adminEmail}`);
      } else {
        const hasSuperAdmin = await User.exists({ role: 'admin', isSuperAdmin: true });
        let changed = false;
        if (!admin.organization) { admin.organization = organization._id; changed = true; }
        if (!hasSuperAdmin) { admin.isSuperAdmin = true; changed = true; }
        if (changed) await admin.save();
      }
      if (!organization.administrator && admin) {
        organization.administrator = admin._id;
        await organization.save();
      }
    } catch (e) { console.error('Admin seed error:', e.message); }
  })();
  bootPromise.catch(() => { bootPromise = null; });
  return bootPromise;
}

app.use(notFound);
app.use(errorHandler);

module.exports = app;

if (require.main === module) {
  boot().then(() => {
    app.listen(PORT, () => {
      console.log(`\n🚀 ${process.env.APP_NAME || 'CET Exam Portal'} — http://localhost:${PORT} [${process.env.NODE_ENV || 'development'}]`);
    });
  }).catch(e => { console.error(e); process.exit(1); });
}
