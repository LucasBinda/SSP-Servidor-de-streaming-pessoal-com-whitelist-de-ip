// Gerenciador global das tags do <head> (CSS, Viewport e Favicons)
// TODO: Adicionar fontes locais (self-hosted) para substituir a dependência de APIs
(function gerenciarHead() {
  const head = document.head;

  // Garante Meta Tags básicas
  if (!document.querySelector('meta[charset]')) {
    const metaCharset = document.createElement('meta');
    metaCharset.setAttribute('charset', 'UTF-8');
    head.insertBefore(metaCharset, head.firstChild);
  }

  if (!document.querySelector('meta[name="viewport"]')) {
    const metaViewport = document.createElement('meta');
    metaViewport.name = 'viewport';
    metaViewport.content = 'width=device-width, initial-scale=1.0';
    head.appendChild(metaViewport);
  }

  // Injeta Links (CSS e Favicons)
  const links = [
    { rel: 'stylesheet', href: '/css/style.css' },
    { rel: 'icon', type: 'image/x-icon', href: '/favicon/favicon.ico' },
    { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon/favicon-32x32.png' },
    { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/favicon/favicon-16x16.png' },
    { rel: 'apple-touch-icon', sizes: '180x180', href: '/favicon/apple-touch-icon.png' },
    { rel: 'manifest', href: '/favicon/site.webmanifest' }
  ];

  links.forEach((config) => {
    const seletor = `link[rel="${config.rel}"][href="${config.href}"]`;
    if (!document.querySelector(seletor)) {
      const link = document.createElement('link');
      Object.assign(link, config);
      head.appendChild(link);
    }
  });
})();