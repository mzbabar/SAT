'use strict';
// Renders the EJS pages without reading the "views" folder at request time.
// Serverless hosts (Vercel) only ship files they can trace from require() calls, so the templates are
// bundled into lib/views.generated.js by "npm run build:views". In development the .ejs files are read
// from disk so edits show up immediately.
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const viewsDir = path.join(__dirname, '..', 'views');

function readDir(dir, base = '') {
  const out = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(out, readDir(path.join(dir, entry.name), rel));
    else if (entry.name.endsWith('.ejs')) out[rel.replace(/\.ejs$/, '')] = fs.readFileSync(path.join(dir, entry.name), 'utf8');
  }
  return out;
}

const isProd = process.env.NODE_ENV === 'production';
const useDisk = !isProd && process.env.VIEWS_PRECOMPILED !== '1' && fs.existsSync(viewsDir);
let compiledMap = null;

function templates() {
  if (useDisk) return readDir(viewsDir); // re-read on every render so edits show up in development
  if (!compiledMap) compiledMap = require('./views.generated');
  return compiledMap;
}

function render(name, data) {
  const map = templates();
  if (!(name in map)) throw new Error(`View not found: ${name}`);
  return ejs.render(map[name], data, {
    filename: `/views/${name}.ejs`,
    cache: !useDisk,
    includer(original) {
      const key = String(original).replace(/^(\.{1,2}\/)+/, '').replace(/\.ejs$/, '');
      if (!(key in map)) throw new Error(`Include not found: ${original}`);
      return { filename: `/views/${key}.ejs`, template: map[key] };
    },
  });
}

// Replaces Express's own view lookup, which needs the views folder on disk.
function middleware(req, res, next) {
  res.render = function renderView(name, options = {}) {
    const html = render(name, Object.assign({}, res.locals, options));
    this.type('html').send(html);
  };
  next();
}

module.exports = { render, middleware, readDir, viewsDir };
