(() => {
  const fragments = [
    'layout-start',
    'workspace',
    'templates',
    'cases',
    'runs',
    'mock',
    'layout-end',
    'modals'
  ];
  const scripts = [
    'core',
    'templates',
    'cases',
    'generate',
    'runs',
    'mock'
  ];

  async function loadFragment(name) {
    const response = await fetch('/admin/eval/assets/pages/' + name + '.html');
    if (!response.ok) throw new Error('Failed to load page fragment: ' + name);
    return response.text();
  }

  async function boot() {
    const root = document.querySelector('[data-fragment-root]');
    root.innerHTML = (await Promise.all(fragments.map(loadFragment))).join('\n');
    for (const name of scripts) {
      await loadScript('/admin/eval/assets/js/' + name + '.js');
    }
    window.startEvalApp();
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Failed to load script: ' + src));
      document.body.appendChild(script);
    });
  }

  boot().catch((error) => {
    document.body.innerHTML = '<main style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;padding:32px"><h1>页面加载失败</h1><pre>' + String(error && error.message || error) + '</pre></main>';
  });
})();
