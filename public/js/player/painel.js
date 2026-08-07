// Abre/fecha o painel de configurações do player (o botão de engrenagem). O
// painel hospeda áudio, ajustes de tela/imagem, reforço de volume, equalizador
// e stats — cada um montado no seu próprio módulo. As legendas NÃO moram mais
// aqui: migraram pra <track> nativas do <video> (o botão "CC" da barra do
// navegador lista e troca), criadas em preencherFaixas (player/audio.js).
export function configurarPainelConfiguracoes() {
  const btnConfig = document.getElementById('btn-config');
  const painel = document.getElementById('painel-config');

  btnConfig.addEventListener('click', () => {
    const estaAberto = !painel.hidden;
    painel.hidden = estaAberto;
    btnConfig.setAttribute('aria-expanded', String(!estaAberto));
  });

  // Clicar FORA do painel (e fora da engrenagem) fecha o painel. Só age com
  // ele aberto; cliques dentro dele (selects, sliders, botões) não fecham,
  // e clicar na própria engrenagem cai no handler acima (que alterna) — o
  // guard de btnConfig.contains evita o painel abrir e fechar no mesmo clique.
  document.addEventListener('click', (e) => {
    if (painel.hidden) return;
    if (painel.contains(e.target) || btnConfig.contains(e.target)) return;
    painel.hidden = true;
    btnConfig.setAttribute('aria-expanded', 'false');
  });
}
