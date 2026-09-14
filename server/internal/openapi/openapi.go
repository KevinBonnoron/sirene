package openapi

import _ "embed"

//go:embed openapi.json
var Spec []byte

const DocsHTML = `<!doctype html>
<html>
<head>
  <title>Sirene API Reference</title>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body>
  <div id="app"></div>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.68.0" integrity="sha384-ayGz8N+NChlUEfR0zr5Zy3T6Q4lhcdiASJNoshS6+vxV56ZE300qfWNBjj9pqsLN" crossorigin="anonymous"></script>
  <script>Scalar.createApiReference('#app', { url: '/api/openapi.json' })</script>
</body>
</html>`
