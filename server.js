const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 4175;
const RECIPIENT = 'abirsheepanskura004@gmail.com';
const MAX_BODY_BYTES = 16 * 1024;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};
const PRIVATE_FILES = new Set(['server.js', 'package.json', 'RUN-WEBSITE.txt']);

function sendJson(response, status, data) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(JSON.stringify(data));
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      const error = new Error('The form submission is too large.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Please submit the form again.');
    error.status = 400;
    throw error;
  }
}

function cleanText(value, maxLength = 300) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

async function handleContact(request, response) {
  try {
    const form = await readJson(request);
    const fields = {
      name: cleanText(form.name, 120),
      age: cleanText(form.age, 3),
      gender: cleanText(form.gender, 80),
      phone: cleanText(form.phone, 60),
      country: cleanText(form.country, 80),
      country_code: cleanText(form.country_code, 8),
      email: cleanText(form.email, 254)
    };

    if (!fields.name || !fields.gender || !fields.phone || !fields.country_code || !fields.country ||
        !/^\d{1,3}$/.test(fields.age) || Number(fields.age) < 1 || Number(fields.age) > 120 ||
        !/^[^\s@]+@gmail\.com$/i.test(fields.email)) {
      return sendJson(response, 400, { success: false, message: 'Please check the required fields and use a Gmail address.' });
    }

    const submission = {
      ...fields,
      _replyto: fields.email,
      _subject: 'New Nexovetra contact request',
      _template: 'table',
      _honey: cleanText(form._honey, 200)
    };

    const upstream = await fetch(`https://formsubmit.co/ajax/${RECIPIENT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(submission),
      signal: AbortSignal.timeout(15000)
    });
    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok || result.success === false) {
      return sendJson(response, 502, { success: false, message: 'The email service could not accept the message. Please try again.' });
    }
    return sendJson(response, 200, { success: true, message: 'Your message has been submitted.' });
  } catch (error) {
    const status = error.status || 502;
    return sendJson(response, status, {
      success: false,
      message: status < 500 ? error.message : 'We could not reach the email service. Please try again shortly.'
    });
  }
}

async function serveFile(request, response, pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400).end('Bad request');
    return;
  }

  const requested = decodedPath === '/' ? 'home.html' : decodedPath.replace(/^\/+/, '');
  const filePath = path.resolve(ROOT, requested);
  const relativePath = path.relative(ROOT, filePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath) || PRIVATE_FILES.has(path.basename(filePath))) {
    response.writeHead(404).end('Not found');
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[extension];
  if (!contentType) {
    response.writeHead(404).end('Not found');
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    response.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    if (request.method === 'HEAD') response.end();
    else response.end(content);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.code === 'ENOENT' ? 'Not found' : 'Unable to read file');
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/api/contact') {
    if (request.method !== 'POST') return sendJson(response, 405, { success: false, message: 'Use POST to submit the contact form.' });
    return handleContact(request, response);
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD, POST' }).end('Method not allowed');
    return;
  }
  return serveFile(request, response, url.pathname);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Nexovetra is running at http://localhost:${PORT}/home.html`);
  const addresses = Object.values(os.networkInterfaces()).flatMap((entries) => entries || [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);
  addresses.forEach((address) => console.log(`Phone on the same Wi-Fi: http://${address}:${PORT}/home.html`));
  console.log('Keep this terminal open while using the site.');
});
