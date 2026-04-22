export function json(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(body);
}

export function text(res, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

export function notFound(res) {
  json(res, { code: '404', message: 'Not found' }, 404);
}

export function ok(data = null) {
  return { code: '10000', message: 'success', data };
}
