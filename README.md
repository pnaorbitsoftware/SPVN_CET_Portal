# SPVN Exam Portal

MongoDB-based online MCQ examination portal for Shardabai Pawar Vidya Niketan.

## Main Features

- Admin dashboard, students and batches
- Manual and CSV/Excel Question Bank import
- Smart Question Scan for PDF, Word, scans and handwritten photos
- Editable scan review with confidence and answer-source indicators
- Test creation, batch assignment and immediate publishing
- Student dashboard, CET-style exam flow, scoring and results

## Requirements

- Node.js 18 or newer
- MongoDB connection string
- OpenAI API key for PDF, Word and handwritten-image scanning

## Setup

```bash
npm install
npm run dev
```

Open `http://localhost:5000` when `PORT=5000` is configured in `.env`.

For a normal production-style start:

```bash
npm start
```

## Environment

Required values:

```env
MONGO_URI=mongodb+srv://...
SESSION_SECRET=use_a_long_random_secret
PORT=5000
NODE_ENV=development
```

Smart scanner:

```env
GEMINI_API_KEY=your_gemini_api_key
GEMINI_OCR_MODEL=gemini-3.5-flash
OPENAI_API_KEY=your_openai_api_key
OPENAI_OCR_MODEL=gpt-5.6
OPENAI_OCR_REASONING_EFFORT=high
```

The scanner prefers Gemini when `GEMINI_API_KEY` is available and falls back to OpenAI. Neither AI key is required for the deterministic CSV/Excel parser.

## Smart Question Scan

1. Sign in as admin.
2. Open **Smart Question Scan** from the sidebar.
3. Upload one or more supported files together.
4. Review every extracted question and correct low-confidence fields.
5. Save to Question Bank, or create a test and select batches.
6. Choose **Publish now** to show the test on assigned student dashboards.

Supported inputs:

- PDF: typed or scanned, any number of questions per page
- Word: `.doc`, `.docx`, `.rtf`, `.odt`
- Spreadsheet: `.csv`, `.xls`, `.xlsx`
- Images: `.jpg`, `.png`, `.webp`, `.gif`, `.heic`, `.tiff`, `.bmp`
- Text: `.txt`, `.md`

For best handwriting results, use a sharp, straight, well-lit photo and keep question numbers plus A/B/C/D labels clearly visible. AI extraction must be reviewed before publishing.
