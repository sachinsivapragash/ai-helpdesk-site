// Minimal HTML template engine: {{> partial}} includes a file from views/partials,
// {{name}} inserts an HTML-escaped value from site settings or render locals.
const fs = require('fs');
const path = require('path');
const config = require('./config');

const partialsDir = path.join(__dirname, '..', 'views', 'partials');
const cache = new Map();

function read(file) {
  if (config.isProd && cache.has(file)) return cache.get(file);
  const text = fs.readFileSync(file, 'utf8');
  cache.set(file, text);
  return text;
}

function escape(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function render(filePath, options, callback) {
  try {
    const vars = {
      siteName: config.site.name,
      campus: config.site.campus,
      city: config.site.city,
      ownerName: config.owner.name,
      ownerEmail: config.owner.email,
      github: config.owner.github,
      year: new Date().getFullYear(),
      ...options,
    };
    let html = read(filePath).replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_, name) => read(path.join(partialsDir, `${name}.html`)));
    html = html.replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_, name) => read(path.join(partialsDir, `${name}.html`)));
    html = html.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => (key in vars ? escape(vars[key]) : ''));
    callback(null, html);
  } catch (err) {
    callback(err);
  }
}

module.exports = { render };
