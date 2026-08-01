// A engrenagem acompanha a barra de controles nativa: some depois de ~3s sem
// atividade com o vídeo tocando (mesmo timeout do Chrome) pra não ficar na
// frente do filme, e reaparece ao mexer o mouse ou tocar na tela. Nunca some
// com o vídeo pausado (a barra nativa também não some) nem com o painel de
// configurações aberto.
export function configurarOcultarConfigOcioso(video) {
  const shell = document.querySelector('.video-shell');
  const painel = document.getElementById('painel-config');
  const OCIOSO_MS = 3000;
  let timer = null;

  function esconder() {
    if (video.paused || !painel.hidden) return;
    shell.classList.add('controles-ocultos');
  }

  function mostrar() {
    shell.classList.remove('controles-ocultos');
    clearTimeout(timer);
    timer = setTimeout(esconder, OCIOSO_MS);
  }

  shell.addEventListener('pointermove', mostrar);
  shell.addEventListener('pointerdown', mostrar);
  shell.addEventListener('focusin', mostrar);
  // Cursor saiu do vídeo: esconde já, sem esperar o timeout
  shell.addEventListener('pointerleave', () => {
    clearTimeout(timer);
    esconder();
  });
  video.addEventListener('pause', mostrar);
  // O play (inclusive o autoplay) arma a contagem — sem isso a engrenagem
  // ficaria pra sempre na tela se o mouse nunca passasse pelo vídeo.
  video.addEventListener('play', mostrar);
}

// Modo retrato: o filme ocupa a janela inteira do navegador (sem virar tela
// cheia do sistema — a aba e a barra do navegador continuam lá). Esc sai.
export function configurarModosDeTela(video) {
  const btnRetrato = document.getElementById('btn-modo-retrato');

  function definirRetrato(ligado) {
    document.body.classList.toggle('modo-retrato', ligado);
    btnRetrato.setAttribute('aria-pressed', String(ligado));
    btnRetrato.textContent = ligado ? 'Sair do retrato' : 'Modo retrato';
  }

  btnRetrato.addEventListener('click', () => {
    definirRetrato(!document.body.classList.contains('modo-retrato'));
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('modo-retrato')) {
      definirRetrato(false);
    }
  });
}

// Tela cheia (Fullscreen API do SO). O detalhe crucial: pedimos fullscreen ao
// .video-shell — o CONTÊINER — e nunca ao <video>. O fullscreen nativo promove
// só o elemento alvo (e seus descendentes) pra "top layer"; se o alvo é o
// <video>, a engrenagem, a legenda, os stats e o painel — que são IRMÃOS do
// <video> dentro do shell, não filhos dele — ficam de fora e somem. Mirando o
// shell, todos continuam desenhados sobre o filme. (É o mesmo motivo do
// controlslist="nofullscreen": o botão nativo fullscreenava só o <video>.)
export function configurarTelaCheia(video) {
  const btn = document.getElementById('btn-tela-cheia');
  const shell = document.querySelector('.video-shell');
  if (!btn || !shell) return;

  // Navegador sem Fullscreen API (ou bloqueado por política): não oferece um
  // botão que não faria nada.
  if (!document.fullscreenEnabled) {
    btn.hidden = true;
    return;
  }

  const estaCheia = () => document.fullscreenElement === shell;

  function alternar() {
    if (estaCheia()) {
      document.exitFullscreen();
    } else {
      shell.requestFullscreen().catch((err) => {
        console.error('[player] falha ao entrar em tela cheia:', err);
      });
    }
  }

  btn.addEventListener('click', alternar);
  // Duplo-clique no vídeo é o gesto que todo mundo espera pra tela cheia — como
  // o botão nativo foi removido (nofullscreen), redirecionamos pro shell.
  video.addEventListener('dblclick', alternar);

  // Mantém o botão em sincronia com o fullscreen real — cobre o Esc, o F11 e
  // qualquer saída que não passe pelo nosso clique.
  document.addEventListener('fullscreenchange', () => {
    const cheia = estaCheia();
    btn.setAttribute('aria-pressed', String(cheia));
    btn.textContent = cheia ? 'Sair da tela cheia' : 'Tela cheia';
  });
}

// Ajuste de imagem quando o filme ocupa a tela (modo retrato):
// Original mantém a imagem fiel (bordas pretas se a proporção não bater),
// Preencher amplia cortando as beiradas e Esticar deforma até ocupar tudo.
// No layout normal da página não tem efeito — ali a altura do player já
// acompanha a proporção do arquivo. A escolha persiste no localStorage.
export function configurarAjusteDeImagem() {
  const CHAVE_STORAGE = 'sspwi-ajuste-imagem';
  const AJUSTES = ['original', 'preencher', 'esticar'];
  const botoes = Array.from(document.querySelectorAll('.btn-ajuste'));

  function aplicar(ajuste) {
    document.body.classList.toggle('ajuste-preencher', ajuste === 'preencher');
    document.body.classList.toggle('ajuste-esticar', ajuste === 'esticar');
    botoes.forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.ajuste === ajuste));
    });
  }

  let salvo = localStorage.getItem(CHAVE_STORAGE);
  if (!AJUSTES.includes(salvo)) salvo = 'original';
  aplicar(salvo);

  botoes.forEach((btn) => {
    btn.addEventListener('click', () => {
      aplicar(btn.dataset.ajuste);
      localStorage.setItem(CHAVE_STORAGE, btn.dataset.ajuste);
    });
  });
}
