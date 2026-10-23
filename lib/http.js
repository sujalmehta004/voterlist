function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readJsonBody(req, { maxBytes = 32_768 } = {}) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);

  return new Promise((resolve, reject) => {
    let body = '';
    let bodyBytes = 0;
    req.on('data', (chunk) => {
      const text = chunk.toString();
      bodyBytes += Buffer.byteLength(text);
      if (bodyBytes > maxBytes) {
        const error = new Error('Request body is too large.');
        error.statusCode = 413;
        reject(error);
        req.destroy();
        return;
      }
      body += text;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        const error = new Error('Invalid JSON request body.');
        error.statusCode = 400;
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

module.exports = { sendJson, readJsonBody };
