// utils/imageUpload.js
// Uploads images to imgbb.com (free image hosting)
// Get free API key at: https://api.imgbb.com/

const https = require('https');
const querystring = require('querystring');

/**
 * Upload base64 image to imgbb
 * Returns the direct image URL
 */
const uploadToImgbb = (base64Data, fileName = 'question') => {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.IMGBB_API_KEY;
    if (!apiKey) {
      // Fallback: save locally if no API key
      return resolve(null);
    }

    // Strip data URI prefix if present
    const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');

    const postData = querystring.stringify({
      key: apiKey,
      image: cleanBase64,
      name: fileName,
    });

    const options = {
      hostname: 'api.imgbb.com',
      path: '/1/upload',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.success) {
            resolve(parsed.data.url);
          } else {
            reject(new Error('imgbb upload failed: ' + JSON.stringify(parsed)));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
};

/**
 * Process uploaded file from express-fileupload and upload to imgbb
 * Falls back to local storage if no API key configured
 */
const processQuestionImage = async (file, fieldName = 'question') => {
  if (!file) return null;

  try {
    const base64 = file.data.toString('base64');
    const imgbbUrl = await uploadToImgbb(base64, fieldName);
    if (imgbbUrl) return imgbbUrl;

    // Fallback: save locally
    const path = require('path');
    const fs = require('fs');
    const ext = path.extname(file.name) || '.jpg';
    const filename = `${fieldName}_${Date.now()}${ext}`;
    const uploadPath = path.join(__dirname, '..', 'public', 'uploads', 'questions', filename);
    await file.mv(uploadPath);
    return `/uploads/questions/${filename}`;
  } catch (err) {
    console.error('Image upload error:', err.message);
    return null;
  }
};

module.exports = { uploadToImgbb, processQuestionImage };
